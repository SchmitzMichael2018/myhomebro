from __future__ import annotations

from pathlib import PurePosixPath

from django.db import transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import CustomerRequest, PropertyProfile
from projects.models_project_intake import ProjectIntake, ProjectIntakeClarificationPhoto
from projects.models_diy_planner import (
    DIYProject, DIYProjectAIProposal, DIYProjectAsset, DIYProjectMeasurement,
    DIYProjectPhase, DIYProjectProgressEntry, DIYProjectRequestLink, DIYProjectTask,
)
from projects.services.diy_planner import apply_plan_proposal, build_plan_proposal
from projects.views.customer_portal import _primary_homeowner_for_email, _unsign_portal_token


def portal_email(token):
    try:
        return _unsign_portal_token(token).lower().strip()
    except Exception:
        return None


def owned_project(token, project_id):
    email = portal_email(token)
    if not email:
        raise NotFound("Project not found.")
    return email, get_object_or_404(DIYProject, id=project_id, owner_email__iexact=email)


class ProjectWriteSerializer(serializers.ModelSerializer):
    property_id = serializers.IntegerField(required=False, allow_null=True, write_only=True)

    class Meta:
        model = DIYProject
        fields = ["title", "desired_outcome", "category", "area", "existing_conditions", "work_completed",
                  "target_budget_min", "target_budget_max", "target_completion_date", "confidence_notes",
                  "design_notes", "additional_context", "status", "property_id"]
        extra_kwargs = {"status": {"required": False}, "desired_outcome": {"required": True}}


class PhaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = DIYProjectPhase
        fields = ["id", "title", "description", "sort_order"]


class TaskSerializer(serializers.ModelSerializer):
    participation_label = serializers.CharField(source="get_participation_type_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = DIYProjectTask
        fields = ["id", "phase", "title", "description", "participation_type", "participation_label", "status",
                  "status_label", "sort_order", "notes", "estimated_duration", "estimated_cost",
                  "prerequisite_notes", "professional_review_recommended", "source"]
        read_only_fields = ["phase", "source"]


def serialize_project(row, request=None, detail=False):
    phases = []
    task_count = complete_count = 0
    if detail:
        for phase in row.phases.prefetch_related("tasks").all():
            tasks = TaskSerializer(phase.tasks.all(), many=True).data
            task_count += len(tasks)
            complete_count += sum(1 for task in tasks if task["status"] == "completed")
            phases.append({**PhaseSerializer(phase).data, "tasks": tasks})
    else:
        task_count = DIYProjectTask.objects.filter(phase__project=row).count()
        complete_count = DIYProjectTask.objects.filter(phase__project=row, status="completed").count()
    progress = round((complete_count / task_count) * 100) if task_count else 0
    payload = {
        "id": str(row.id), "title": row.title, "desired_outcome": row.desired_outcome, "category": row.category,
        "area": row.area, "existing_conditions": row.existing_conditions, "work_completed": row.work_completed,
        "target_budget_min": str(row.target_budget_min) if row.target_budget_min is not None else None,
        "target_budget_max": str(row.target_budget_max) if row.target_budget_max is not None else None,
        "target_completion_date": row.target_completion_date, "confidence_notes": row.confidence_notes,
        "design_notes": row.design_notes, "additional_context": row.additional_context,
        "status": row.status, "status_label": row.get_status_display(), "ai_summary": row.ai_summary,
        "progress_percent": progress, "task_count": task_count, "completed_task_count": complete_count,
        "created_at": row.created_at, "updated_at": row.updated_at,
    }
    if detail:
        payload["phases"] = phases
        payload["measurements"] = [
            {"id": item.id, "label": item.label, "value": str(item.value), "unit": item.unit, "notes": item.notes,
             "verification_status": item.verification_status, "verification_label": item.get_verification_status_display()}
            for item in row.measurements.all()
        ]
        payload["assets"] = [{"id": a.id, "asset_type": a.asset_type, "asset_type_label": a.get_asset_type_display(),
                              "caption": a.caption, "task_id": a.task_id, "created_at": a.created_at}
                             for a in row.assets.all()]
        payload["progress_entries"] = [
            {"id": e.id, "task_id": e.task_id, "note": e.note, "from_status": e.from_status,
             "to_status": e.to_status, "created_at": e.created_at} for e in row.progress_entries.all()[:50]
        ]
        payload["request_links"] = [
            {"id": link.id, "customer_request_id": link.customer_request_id,
             "status": getattr(link.customer_request, "status", ""),
             "status_label": getattr(link.customer_request, "get_status_display", lambda: "")(),
             "project_mode": getattr(link.customer_request, "project_mode", ""),
             "project_mode_label": getattr(link.customer_request, "get_project_mode_display", lambda: "")(),
             "routed_contractor_count": (
                 link.customer_request.source_intake.contractor_opportunities.count()
                 if getattr(link.customer_request, "source_intake_id", None) else 0
             ),
             "created_at": link.created_at}
            for link in row.request_links.select_related("customer_request", "customer_request__source_intake").all()
        ]
    return payload


class DIYProjectListCreateView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, token):
        email = portal_email(token)
        if not email:
            return Response({"detail": "Invalid portal link."}, status=403)
        return Response({"projects": [serialize_project(row) for row in DIYProject.objects.filter(owner_email__iexact=email)]})

    def post(self, request, token):
        email = portal_email(token)
        if not email:
            return Response({"detail": "Invalid portal link."}, status=403)
        serializer = ProjectWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        property_id = data.pop("property_id", None)
        profile = None
        if property_id:
            profile = get_object_or_404(PropertyProfile, id=property_id, customer_email__iexact=email)
        row = DIYProject.objects.create(owner_email=email, property_profile=profile, **data)
        return Response(serialize_project(row, detail=True), status=201)


class DIYProjectDetailView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, token, project_id):
        _email, row = owned_project(token, project_id)
        return Response(serialize_project(row, detail=True))

    def patch(self, request, token, project_id):
        email, row = owned_project(token, project_id)
        serializer = ProjectWriteSerializer(row, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        property_id = data.pop("property_id", None)
        if property_id is not None:
            row.property_profile = get_object_or_404(PropertyProfile, id=property_id, customer_email__iexact=email)
        for key, value in data.items():
            setattr(row, key, value)
        row.save()
        return Response(serialize_project(row, detail=True))

    def delete(self, request, token, project_id):
        _email, row = owned_project(token, project_id)
        row.status = DIYProject.Status.ARCHIVED
        row.save(update_fields=["status", "updated_at"])
        return Response(status=204)


class DIYPhaseListCreateView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token, project_id):
        _email, project = owned_project(token, project_id)
        serializer = PhaseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phase = serializer.save(project=project)
        return Response(PhaseSerializer(phase).data, status=201)


class DIYPhaseDetailView(APIView):
    permission_classes = [AllowAny]

    def _row(self, token, project_id, phase_id):
        _email, project = owned_project(token, project_id)
        return get_object_or_404(DIYProjectPhase, id=phase_id, project=project)

    def patch(self, request, token, project_id, phase_id):
        row = self._row(token, project_id, phase_id)
        serializer = PhaseSerializer(row, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, token, project_id, phase_id):
        self._row(token, project_id, phase_id).delete()
        return Response(status=204)


class DIYTaskListCreateView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token, project_id, phase_id):
        _email, project = owned_project(token, project_id)
        phase = get_object_or_404(DIYProjectPhase, id=phase_id, project=project)
        serializer = TaskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = serializer.save(phase=phase, source=DIYProjectTask.Source.HOMEOWNER)
        return Response(TaskSerializer(task).data, status=201)


class DIYTaskDetailView(APIView):
    permission_classes = [AllowAny]

    def _row(self, token, project_id, task_id):
        _email, project = owned_project(token, project_id)
        return get_object_or_404(DIYProjectTask, id=task_id, phase__project=project)

    def patch(self, request, token, project_id, task_id):
        row = self._row(token, project_id, task_id)
        old_status = row.status
        serializer = TaskSerializer(row, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        if row.status != old_status or request.data.get("progress_note"):
            DIYProjectProgressEntry.objects.create(
                project=row.phase.project, task=row, note=str(request.data.get("progress_note") or "")[:2000],
                from_status=old_status, to_status=row.status, created_by_email=row.phase.project.owner_email,
            )
        return Response(TaskSerializer(row).data)

    def delete(self, request, token, project_id, task_id):
        self._row(token, project_id, task_id).delete()
        return Response(status=204)


class DIYMeasurementListCreateView(APIView):
    permission_classes = [AllowAny]

    class Input(serializers.Serializer):
        label = serializers.CharField(max_length=160)
        value = serializers.DecimalField(max_digits=14, decimal_places=4)
        unit = serializers.CharField(max_length=40)
        notes = serializers.CharField(required=False, allow_blank=True)

    def post(self, request, token, project_id):
        _email, project = owned_project(token, project_id)
        serializer = self.Input(data=request.data)
        serializer.is_valid(raise_exception=True)
        row = DIYProjectMeasurement.objects.create(project=project, **serializer.validated_data)
        return Response({"id": row.id, **serializer.validated_data,
                         "verification_status": row.verification_status,
                         "verification_label": row.get_verification_status_display()}, status=201)


class DIYMeasurementDetailView(APIView):
    permission_classes = [AllowAny]

    def _row(self, token, project_id, measurement_id):
        _email, project = owned_project(token, project_id)
        return get_object_or_404(DIYProjectMeasurement, id=measurement_id, project=project)

    def patch(self, request, token, project_id, measurement_id):
        row = self._row(token, project_id, measurement_id)
        serializer = DIYMeasurementListCreateView.Input(
            data={"label": row.label, "value": row.value, "unit": row.unit, "notes": row.notes, **request.data}
        )
        serializer.is_valid(raise_exception=True)
        for key, value in serializer.validated_data.items():
            setattr(row, key, value)
        row.save(update_fields=["label", "value", "unit", "notes"])
        return Response({"id": row.id, **serializer.validated_data,
                         "verification_status": row.verification_status,
                         "verification_label": row.get_verification_status_display()})

    def delete(self, request, token, project_id, measurement_id):
        self._row(token, project_id, measurement_id).delete()
        return Response(status=204)


class DIYProgressEntryView(APIView):
    permission_classes = [AllowAny]

    class Input(serializers.Serializer):
        note = serializers.CharField(max_length=2000)
        task_id = serializers.IntegerField(required=False, allow_null=True)

    def post(self, request, token, project_id):
        email, project = owned_project(token, project_id)
        serializer = self.Input(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = None
        if serializer.validated_data.get("task_id"):
            task = get_object_or_404(DIYProjectTask, id=serializer.validated_data["task_id"], phase__project=project)
        row = DIYProjectProgressEntry.objects.create(
            project=project, task=task, note=serializer.validated_data["note"], created_by_email=email
        )
        return Response({"id": row.id, "task_id": row.task_id, "note": row.note, "created_at": row.created_at}, status=201)


class DIYAssetView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, token, project_id):
        email, project = owned_project(token, project_id)
        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"detail": "Choose a file."}, status=400)
        if uploaded.size > 15 * 1024 * 1024:
            return Response({"detail": "Files must be 15 MB or smaller."}, status=400)
        asset_type = request.data.get("asset_type") or DIYProjectAsset.Type.PROJECT
        if asset_type not in {c for c, _ in DIYProjectAsset.Type.choices}:
            return Response({"detail": "Invalid asset type."}, status=400)
        task = None
        if request.data.get("task_id"):
            task = get_object_or_404(DIYProjectTask, id=request.data["task_id"], phase__project=project)
        row = DIYProjectAsset.objects.create(project=project, task=task, asset_type=asset_type, file=uploaded,
                                             caption=str(request.data.get("caption") or "")[:255], uploaded_by_email=email)
        return Response({"id": row.id, "asset_type": row.asset_type, "caption": row.caption}, status=201)


class DIYAssetDetailView(APIView):
    permission_classes = [AllowAny]

    def _row(self, token, project_id, asset_id):
        _email, project = owned_project(token, project_id)
        return get_object_or_404(DIYProjectAsset, id=asset_id, project=project)

    def get(self, request, token, project_id, asset_id):
        row = self._row(token, project_id, asset_id)
        return FileResponse(row.file.open("rb"), as_attachment=False, filename=row.file.name.rsplit("/", 1)[-1])

    def delete(self, request, token, project_id, asset_id):
        row = self._row(token, project_id, asset_id)
        row.file.delete(save=False)
        row.delete()
        return Response(status=204)


class DIYAIProposalView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token, project_id):
        _email, project = owned_project(token, project_id)
        payload = build_plan_proposal(project)
        proposal = DIYProjectAIProposal.objects.create(project=project, payload=payload)
        return Response({"proposal_id": str(proposal.id), "status": proposal.status, **payload}, status=201)


class DIYAIProposalApplyView(APIView):
    permission_classes = [AllowAny]

    class Input(serializers.Serializer):
        selected_keys = serializers.ListField(child=serializers.CharField(max_length=80), allow_empty=False)

    def post(self, request, token, project_id, proposal_id):
        _email, project = owned_project(token, project_id)
        serializer = self.Input(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = get_object_or_404(DIYProjectAIProposal, id=proposal_id, project=project)
        apply_plan_proposal(proposal, serializer.validated_data["selected_keys"])
        return Response({"proposal_id": str(proposal.id), "status": proposal.status,
                         "project": serialize_project(project, detail=True)})


class DIYGetHelpView(APIView):
    permission_classes = [AllowAny]

    class Input(serializers.Serializer):
        selection_type = serializers.ChoiceField(choices=["task", "tasks", "phase", "remaining"])
        task_ids = serializers.ListField(child=serializers.IntegerField(), required=False)
        phase_id = serializers.IntegerField(required=False)
        asset_ids = serializers.ListField(child=serializers.IntegerField(), required=False)
        measurement_ids = serializers.ListField(child=serializers.IntegerField(), required=False)
        project_mode = serializers.ChoiceField(choices=[c for c, _ in CustomerRequest.PROJECT_MODE_CHOICES])
        title = serializers.CharField(max_length=200, required=False, allow_blank=True)
        scope = serializers.CharField(required=False, allow_blank=True)
        idempotency_key = serializers.CharField(max_length=100)

    @transaction.atomic
    def post(self, request, token, project_id):
        email, project = owned_project(token, project_id)
        serializer = self.Input(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        existing = DIYProjectRequestLink.objects.filter(diy_project=project, idempotency_key=data["idempotency_key"]).select_related("customer_request").first()
        if existing:
            return Response({"link_id": existing.id, "request_id": existing.customer_request_id, "created": False})
        tasks = DIYProjectTask.objects.filter(phase__project=project)
        if data["selection_type"] in {"task", "tasks"}:
            tasks = tasks.filter(id__in=data.get("task_ids", []))
        elif data["selection_type"] == "phase":
            tasks = tasks.filter(phase_id=data.get("phase_id"))
        else:
            tasks = tasks.exclude(status__in=[DIYProjectTask.Status.COMPLETED, DIYProjectTask.Status.SKIPPED])
        task_list = list(tasks.select_related("phase"))
        if not task_list:
            return Response({"detail": "Select at least one task to include."}, status=400)
        assets = list(project.assets.filter(id__in=data.get("asset_ids", [])))
        measurements = list(project.measurements.filter(id__in=data.get("measurement_ids", [])))
        if len(assets) != len(set(data.get("asset_ids", []))) or len(measurements) != len(set(data.get("measurement_ids", []))):
            return Response({"detail": "One or more selected supporting details do not belong to this project."}, status=400)
        generated_scope = "\n".join([f"- {t.phase.title}: {t.title} — {t.description}".strip() for t in task_list])
        scope = data.get("scope") or (
            f"Desired outcome: {project.desired_outcome}\n"
            f"Existing conditions: {project.existing_conditions or 'Not provided'}\n"
            f"Work already completed: {project.work_completed or 'None provided'}\n"
            f"Selected work:\n{generated_scope}"
        )
        if data.get("scope"):
            scope += f"\n\nSelected professional-help work:\n{generated_scope}"
        if measurements:
            scope += "\n\nShared homeowner-provided measurements (verify before pricing or work):\n" + "\n".join(
                f"- {row.label}: {row.value} {row.unit}" for row in measurements
            )
        if assets:
            scope += "\n\nShared project files:\n" + "\n".join(
                f"- Project file #{asset.id}: {asset.caption or asset.get_asset_type_display()}" for asset in assets
            )
        request_row = CustomerRequest.objects.create(
            homeowner=_primary_homeowner_for_email(email), property_profile=project.property_profile,
            customer_email=email, request_type=CustomerRequest.TYPE_DIY_ASSISTANCE,
            project_mode=data["project_mode"], project_category=project.category,
            project_type=project.category, title=data.get("title") or f"Help with {project.title}",
            description=scope, preferred_timeline=str(project.target_completion_date or ""),
            status=CustomerRequest.STATUS_DRAFT,
        )
        profile = project.property_profile
        continuing_tasks = list(
            DIYProjectTask.objects.filter(
                phase__project=project,
                participation_type=DIYProjectTask.Participation.DO_IT_MYSELF,
            ).select_related("phase")
        )
        budget_range = " â€“ ".join(
            value for value in [
                str(project.target_budget_min) if project.target_budget_min is not None else "",
                str(project.target_budget_max) if project.target_budget_max is not None else "",
            ] if value
        )
        intake = ProjectIntake.objects.create(
            homeowner=request_row.homeowner,
            initiated_by="homeowner",
            status="analyzed",
            lead_source="direct",
            customer_email=email,
            project_mode={
                "diy_assist": "assisted_diy",
                "consultation": "consultation",
                "inspection_only": "inspection_only",
                "full_service": "full_service",
                "not_sure": "full_service",
            }.get(data["project_mode"], "full_service"),
            property_type=getattr(profile, "property_type", "") or "",
            budget_range_text=budget_range,
            desired_timing_text=str(project.target_completion_date or ""),
            homeowner_participation_notes=project.work_completed,
            homeowner_started_work=bool(project.work_completed),
            homeowner_task_summary="\n".join(
                f"- {task.phase.title}: {task.title}" for task in continuing_tasks
            ),
            homeowner_assistance_summary=generated_scope,
            project_address_line1=getattr(profile, "address_line1", "") or "",
            project_address_line2=getattr(profile, "address_line2", "") or "",
            project_city=getattr(profile, "city", "") or "",
            project_state=getattr(profile, "state", "") or "",
            project_postal_code=getattr(profile, "postal_code", "") or "",
            accomplishment_text=scope,
            ai_project_title=request_row.title,
            ai_project_type=request_row.project_type,
            ai_description=scope,
            measurement_handling="provided" if measurements else "",
            ai_clarification_answers={
                "existing_conditions": project.existing_conditions,
                "work_completed": project.work_completed,
                "shared_measurements": [
                    {"label": row.label, "value": str(row.value), "unit": row.unit}
                    for row in measurements
                ],
            },
            ai_analysis_payload={
                "origin": "homeowner_diy_project",
                "source_customer_request_id": request_row.id,
                "measurements": [
                    {"label": row.label, "value": str(row.value), "unit": row.unit}
                    for row in measurements
                ],
            },
        )
        intake.ensure_share_token(save=True)
        request_row.source_intake = intake
        request_row.save(update_fields=["source_intake", "updated_at"])
        for asset in assets:
            ProjectIntakeClarificationPhoto.objects.create(
                project_intake=intake,
                image=asset.file.name,
                original_name=PurePosixPath(asset.file.name).name,
                caption=asset.caption or asset.get_asset_type_display(),
            )
        link = DIYProjectRequestLink.objects.create(diy_project=project, customer_request=request_row,
                                                   idempotency_key=data["idempotency_key"])
        return Response({"link_id": link.id, "request_id": request_row.id, "created": True,
                         "status": request_row.status, "detail": "Private request draft created for review."}, status=201)
