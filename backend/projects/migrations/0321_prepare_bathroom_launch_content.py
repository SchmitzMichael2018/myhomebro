from django.db import migrations


CATEGORY = "bathroom"


TEMPLATES = [
    {
        "key": "remodel:bathroom_remodel",
        "aliases": {"bathroom remodel", "bathroom remodel planning"},
        "name": "Bathroom Remodel",
        "public_title": "Bathroom Remodel Planning",
        "slug": "bathroom-remodel-planning",
        "project_type": "Remodel",
        "project_subtype": "Bathroom Remodel",
        "difficulty": "advanced",
        "days": (7, 21),
        "summary": "Plan a bathroom remodel by documenting existing conditions, defining scope and selections, sequencing trades, setting milestones, and preparing for hidden conditions.",
        "intro": (
            "A bathroom remodel plan should connect the homeowner's goals to the room's existing conditions, measurements, layout, fixtures, storage, lighting, ventilation, flooring, walls, plumbing, and electrical needs. The purpose of this guide is planning—not treating a multi-trade remodel as one oversized DIY task.\n\n"
            "Begin with a measured existing-condition record and a written scope. Decide what remains, what changes, who supplies each selection, and whether plumbing or electrical locations move. Plan the conceptual order of work: protection and selective removal; concealed-condition review; approved rough plumbing or electrical work; substrate and waterproofing work; finishes and fixtures; then testing, applicable inspections, and a final punch list."
        ),
        "scope": (
            "Document goals, measurements, layout constraints, fixture and storage needs, lighting and ventilation, finish selections, plumbing and electrical implications, work sequencing, contractor responsibilities, decision deadlines, milestone acceptance, and closeout. Keep allowances, owner-supplied items, exclusions, and responsibility for permits or inspections explicit."
        ),
        "materials": "Selections may include plumbing fixtures, vanity and storage, lighting, ventilation equipment, wall and floor finishes, waterproofing components, trim, sealants, and accessories. Compatibility and manufacturer requirements matter more than assembling a generic shopping list.",
        "tools": "Planning commonly uses a tape measure, level, camera, notebook or digital plan, fixture specification sheets, and a way to record shutoffs and existing conditions. Trade work may require specialized tools that should be selected by the qualified person performing it.",
        "cost": "Cost depends on room condition, project scope, finish and fixture selections, layout changes, plumbing or electrical work, ventilation, waterproofing, demolition, disposal, local labor, applicable permits or inspections, and concealed damage. Maintain a contingency instead of assuming every condition is visible before work begins.",
        "preparation": "Photograph and measure the room; locate accessible water shutoffs and electrical controls; identify ventilation; document walls, floors, and visible moisture damage; confirm product lead times; define bathroom access during work; and record who selects, purchases, receives, and inspects each item.",
        "safety": "Do not disturb suspected hazardous materials or concealed electrical, plumbing, structural, or moisture-damaged conditions without appropriate evaluation. Water and power controls should be identified before work starts. Follow product instructions, use appropriate PPE, and use qualified help for work beyond the person's competence. Permit and inspection requirements vary by jurisdiction and scope.",
        "mistakes": "Common planning failures include ordering before measuring, leaving product compatibility unverified, moving fixtures without accounting for trade work, omitting ventilation or waterproofing details, assuming walls and floors are sound, overlapping trade responsibilities, and scheduling finish work before concealed work is accepted.",
        "diy": "DIY planning and limited finish work may be reasonable when the homeowner can measure accurately, document selections, coordinate dependencies, and keep higher-risk trade work outside their scope. Treat the plan as a sequence of reviewable decisions rather than a promise that all work is DIY-suitable.",
        "pro": "Professional help may be appropriate for layout changes, plumbing or electrical relocation, waterproofed assemblies, structural or extensive substrate repair, ventilation changes, custom glass, uncertain code or permit requirements, or coordination of multiple trades.",
        "seo_title": "Bathroom Remodel Planning Guide | MyHomeBro",
        "seo_description": "Plan bathroom scope, layout, fixtures, sequencing, safety, milestones, budget drivers, and when qualified professional help may be appropriate.",
        "faqs": [
            {"question": "What should I decide before starting a bathroom remodel?", "answer": "Document goals, measurements, existing conditions, layout, fixtures, finishes, storage, ventilation, budget drivers, responsibilities, and the order in which dependent work will occur."},
            {"question": "What is the typical order of a bathroom remodel?", "answer": "A common sequence is planning and protection, selective removal, concealed-condition review, approved rough work, substrate and waterproofing work, finishes and fixtures, testing, applicable inspections, and punch-list closeout."},
            {"question": "How much contingency should I plan?", "answer": "There is no universal percentage. The appropriate contingency depends on how much is concealed, the age and condition of the room, scope certainty, and the risk of product or repair changes."},
            {"question": "When should I involve a professional?", "answer": "Consider qualified help when the work changes plumbing, electrical, structure, ventilation, waterproofed assemblies, custom glass, or reveals conditions you cannot confidently assess."},
        ],
        "milestones": [
            ("Goals, Existing Conditions & Measurements", "Record goals, dimensions, fixture locations, ventilation, visible damage, access constraints, and items that require further evaluation.", "planning", 1),
            ("Scope, Layout & Selections", "Confirm retained and replaced items, layout, fixtures, storage, lighting, finishes, responsibilities, compatibility, and decision deadlines.", "scope_planning", 2),
            ("Budget, Schedule & Coordination", "Document cost drivers, contingency approach, product lead times, trade sequence, bathroom access, permits or inspections where applicable, and milestone acceptance.", "project_planning", 3),
            ("Protection, Removal & Condition Review", "Protect adjacent areas, complete agreed selective removal, and stop for review when concealed damage or unexpected systems are exposed.", "demolition", 4),
            ("Approved Rough Work & Substrates", "Complete authorized plumbing, electrical, ventilation, repair, substrate, and waterproofing work before finishes conceal it.", "rough_in", 5),
            ("Finishes, Fixtures & Connections", "Install approved surfaces, fixtures, storage, trim, and accessories in dependency order and according to product requirements.", "installation", 6),
            ("Testing, Inspection & Punch List", "Test operation and leaks, complete applicable inspections, document corrections, clean the area, and close the final punch list.", "final_walkthrough", 7),
        ],
    },
    {
        "key": "bathroom:replace_vanity",
        "aliases": {"bathroom vanity", "vanity replacement", "replace bathroom vanity"},
        "name": "Replace Bathroom Vanity",
        "public_title": "Replace Bathroom Vanity",
        "slug": "replace-bathroom-vanity",
        "project_type": "Remodel",
        "project_subtype": "Bathroom Vanity Replacement",
        "difficulty": "intermediate",
        "days": (1, 3),
        "summary": "Plan a bathroom vanity replacement around accurate measurements, plumbing alignment, wall support, countertop and sink compatibility, finish repairs, and final leak testing.",
        "intro": "A same-location vanity replacement can be a manageable project when the new cabinet, sink, faucet, drain, and supply connections fit the existing space. Difficulty rises when plumbing moves, shutoff valves are unreliable, the wall or floor is damaged, electrical work changes, or a custom countertop requires field coordination.",
        "scope": "Measure the opening and clearances; verify vanity width, depth, height, door and drawer operation, plumbing location, sink and countertop configuration, faucet compatibility, wall attachment, backsplash, and finish transitions. Remove the existing vanity, review exposed conditions, install and secure the replacement, reconnect compatible plumbing, seal appropriate joints, and inspect for leaks.",
        "materials": "Project-specific materials may include the vanity, compatible top and sink, faucet, drain components, supply lines, approved wall fasteners, shims, backsplash or side splash, and manufacturer-approved sealant. Reuse plumbing components only when their condition and compatibility are acceptable.",
        "tools": "Common planning and installation tools may include a tape measure, level, stud finder appropriate for the wall, adjustable wrenches, basin or plumbing tools suited to the connections, screwdrivers or driver, shims, utility knife, containers and towels for residual water, and PPE.",
        "cost": "Cost is driven by cabinet construction, size, countertop and sink type, faucet and drain selections, plumbing alignment, wall or floor repair, backsplash, disposal, custom fabrication, and local labor. Relocating plumbing or electrical work can change the scope substantially.",
        "preparation": "Measure the room and existing vanity in multiple locations; confirm door, drawer, toilet, and walkway clearances; photograph plumbing; verify product and hole compatibility; identify wall attachment points; protect the floor; clear the cabinet; and plan for the bathroom to be unavailable while connections are open.",
        "safety": "Turn off water and verify it is off before disconnecting supply lines. Expect residual water and protect the floor. Vanities and tops can be heavy or awkward; use appropriate lifting help. Do not conceal active leaks, unstable wall attachment, damaged flooring, or deteriorated plumbing. Electrical changes should be handled only by someone qualified for that work.",
        "mistakes": "Common problems include measuring only the old cabinet, overlooking trim or door clearance, ordering an incompatible sink or faucet pattern, forcing misaligned plumbing, failing to anchor the cabinet securely, trapping an active leak, damaging finished walls, and applying sealant before fit and level are confirmed.",
        "diy": "DIY may be reasonable for a straightforward same-location replacement when measurements, product compatibility, shutoffs, drain alignment, wall attachment, and minor finish work are understood. Plan for careful lifting and repeated leak checks.",
        "pro": "Professional help may be appropriate when plumbing must move, shutoff valves are deteriorated, electrical work changes, walls or floors need significant repair, the countertop requires custom fabrication, attachment conditions are uncertain, or leaks persist after reconnection.",
        "seo_title": "How to Replace a Bathroom Vanity | MyHomeBro",
        "seo_description": "Plan a bathroom vanity replacement with measurement, plumbing, attachment, installation, leak-testing, DIY, and professional-help guidance.",
        "faqs": [
            {"question": "Can I replace a vanity without moving plumbing?", "answer": "Often, if the new cabinet, sink, drain, and supply openings align with the existing connections. Verify dimensions and access before purchasing."},
            {"question": "How do I measure for a replacement vanity?", "answer": "Measure available width, depth, height, wall conditions, plumbing locations, trim, doors, drawers, toilet clearance, and the walking path—not only the old cabinet."},
            {"question": "Should the vanity be attached to the wall?", "answer": "Follow the vanity manufacturer's instructions and use attachment methods appropriate for the wall and cabinet. Do not rely on plumbing connections to restrain the vanity."},
            {"question": "When should I call a professional?", "answer": "Seek qualified help for plumbing relocation, unreliable shutoffs, electrical changes, extensive wall or floor damage, custom tops, uncertain attachment, or leaks you cannot resolve."},
        ],
        "milestones": [
            ("Measure & Confirm Compatibility", "Confirm opening dimensions, clearances, plumbing locations, sink, faucet, countertop, attachment, and finish-transition requirements.", "planning", 1),
            ("Shut Down, Protect & Remove", "Protect surfaces, turn off and verify water, disconnect compatible components, and remove the existing vanity using safe lifting practices.", "removal", 2),
            ("Inspect & Prepare Surfaces", "Review shutoffs, drain, wall support, floor, and exposed damage; complete approved repairs before covering the area.", "site_preparation", 3),
            ("Set, Level & Secure Vanity", "Position, shim, level, and attach the cabinet and top according to manufacturer and wall requirements.", "vanity_installation", 4),
            ("Connect, Seal & Test", "Reconnect compatible water and drain components, complete backsplash or sealant work, test repeatedly for leaks, and finish the punch list.", "testing", 5),
        ],
    },
    {
        "key": "bathroom:replace_faucet",
        "aliases": {"bathroom faucet", "faucet replacement", "replace bathroom faucet"},
        "name": "Replace Bathroom Faucet",
        "public_title": "Replace Bathroom Faucet",
        "slug": "replace-bathroom-faucet",
        "project_type": "Plumbing",
        "project_subtype": "Bathroom Faucet Replacement",
        "difficulty": "intermediate",
        "days": (1, 2),
        "summary": "Replace a bathroom faucet by confirming sink-hole compatibility, safely isolating water, removing old hardware, reconnecting supplies and drain components, and checking for leaks.",
        "intro": "A faucet replacement is most predictable when the new faucet matches the sink's hole configuration and the existing shutoff valves, supply connections, mounting area, and drain are in serviceable condition. Corrosion, restricted cabinet access, deteriorated valves, and incompatible parts can turn a small fixture change into plumbing repair.",
        "scope": "Identify the sink-hole configuration and faucet type; inspect supply lines, shutoff valves, mounting hardware, and drain or pop-up arrangement; isolate and verify water; remove the old faucet; clean and inspect the mounting surface; install the compatible faucet and applicable drain parts; reconnect supplies; then test operation and every disturbed joint.",
        "materials": "Materials may include a compatible faucet, manufacturer-specified mounting and sealing parts, compatible supply lines, and drain or pop-up components when included in scope. Do not assume old supply or sealing components should be reused.",
        "tools": "Depending on access and hardware, tools may include adjustable wrenches, a basin wrench or suitable faucet tool, screwdrivers, pliers appropriate to the connection, a light, containers and towels for residual water, cleaning materials, and PPE. Use manufacturer-specified tools and sealants.",
        "cost": "Cost depends on faucet quality and configuration, included drain hardware, access beneath the sink, corrosion, supply-line condition, shutoff-valve condition, sink damage, and local labor. A failed shutoff or deteriorated connection expands the project beyond a simple faucet swap.",
        "preparation": "Confirm the number and spacing of sink holes, faucet reach and clearance, supply connection compatibility, drain scope, and cabinet access. Read the manufacturer instructions, clear the cabinet, protect stored surfaces, locate the correct water controls, and have a plan for residual water.",
        "safety": "TURN OFF WATER AND VERIFY IT IS OFF BEFORE DISCONNECTING SUPPLY LINES. Open the faucet to relieve pressure and expect residual water. Do not force corroded connections or continue when a shutoff will not fully isolate the supply. Follow manufacturer instructions and use qualified plumbing help when the condition of valves or piping is uncertain.",
        "mistakes": "Common issues include buying the wrong hole configuration, assuming shutoffs work, twisting or stressing fixed piping, reusing deteriorated supply lines, installing sealing parts incorrectly, overlooking the drain or pop-up, working without room to control tools, and checking for leaks only once.",
        "diy": "DIY may be reasonable when the faucet matches the sink, cabinet access is adequate, shutoff valves operate correctly, connections are in good condition, and the installer can follow the manufacturer's assembly and testing sequence.",
        "pro": "Professional help may be appropriate for seized or leaking shutoffs, heavily corroded connections, damaged piping, inaccessible mounting hardware, cracked sink surfaces, configuration changes, or leaks that continue after careful reconnection.",
        "seo_title": "How to Replace a Bathroom Faucet | MyHomeBro",
        "seo_description": "Learn faucet compatibility, water shutoff, removal, drain and supply reconnection, leak testing, common problems, and when to call a plumber.",
        "faqs": [
            {"question": "How do I know what size faucet fits my sink?", "answer": "Check the number of mounting holes, their spacing, deck thickness, faucet reach, clearance, and the manufacturer's compatibility dimensions."},
            {"question": "Do I need to replace the supply lines?", "answer": "Inspect their condition and confirm connection compatibility. Deteriorated, damaged, or incompatible lines should not be reused; follow product and plumbing guidance."},
            {"question": "Why is the faucet leaking after installation?", "answer": "Possible causes include an incorrectly seated seal, loose or misaligned connection, damaged component, incompatible fitting, or a disturbed drain connection. Turn water off if leakage continues."},
            {"question": "When is this no longer a simple DIY faucet replacement?", "answer": "Stop and consider a plumber when shutoffs do not isolate water, piping moves or appears damaged, corrosion prevents controlled removal, the sink is damaged, or leaks persist."},
        ],
        "milestones": [
            ("Confirm Faucet & Connection Compatibility", "Verify sink holes, faucet dimensions, supplies, shutoffs, mounting access, and whether drain or pop-up work is included.", "planning", 1),
            ("Isolate Water & Remove Faucet", "Turn off and verify water, relieve pressure, contain residual water, disconnect controlled connections, and remove old mounting hardware.", "removal", 2),
            ("Prepare Surface & Install", "Clean and inspect the mounting surface, then install faucet and applicable drain components according to manufacturer instructions.", "installation", 3),
            ("Reconnect, Operate & Leak-Test", "Reconnect compatible supplies, restore water gradually, operate the faucet and drain, and inspect every disturbed joint repeatedly.", "testing", 4),
        ],
    },
    {
        "key": "bathroom:replace_toilet",
        "aliases": {"toilet replacement", "toilet installation", "replace toilet"},
        "name": "Replace Toilet",
        "public_title": "Replace Toilet",
        "slug": "replace-toilet",
        "project_type": "Plumbing",
        "project_subtype": "Toilet Replacement",
        "difficulty": "intermediate",
        "days": (1, 2),
        "summary": "Plan a toilet replacement by confirming rough-in and fixture compatibility, handling the heavy fixture safely, inspecting the flange and floor, setting the seal, and leak-testing.",
        "intro": "A toilet replacement depends on more than choosing a new fixture. Confirm the rough-in and available clearance, isolate and drain the fixture, plan safe lifting, inspect the flange and surrounding floor, use a compatible seal, set the toilet without rocking, reconnect water, and test multiple fill and flush cycles.",
        "scope": "Measure rough-in and clearances; select a compatible toilet; isolate water; drain the tank and bowl; disconnect supply; remove and dispose of the existing fixture appropriately; inspect flange, fasteners, drain opening, and floor; install the compatible seal; set and secure the toilet without overtightening; reconnect supply; then fill, flush, and inspect for leaks or movement.",
        "materials": "Materials may include a compatible toilet, manufacturer-required hardware, a seal suited to the flange and fixture, flange bolts, a compatible supply line, shims approved for the application, and appropriate finishing sealant where used. Flange or floor repair is a separate condition-dependent scope.",
        "tools": "Typical tools may include a tape measure, adjustable wrench, appropriate drivers, small hand tools for existing hardware, a container and absorbent materials, a suitable method to remove remaining bowl water, a level, PPE, and safe lifting equipment or a second person.",
        "cost": "Cost depends on toilet type, rough-in compatibility, accessibility, removal and disposal, supply condition, flange height and damage, floor or subfloor repair, drain problems, and local labor. A damaged flange or soft floor can materially expand the scope.",
        "preparation": "Measure from the finished wall surface to the closet-bolt centerline while accounting for trim; check side and door clearances; inspect the shutoff and supply; read fixture instructions; protect the floor; plan disposal; and arrange two-person lifting when the fixture cannot be handled safely by one person.",
        "safety": "Toilets are heavy, awkward, and can break. Use safe lifting practices and two-person handling where appropriate. Turn off water and verify it is off before disconnecting the supply. Keep the drain opening controlled during the work. Do not install over a badly damaged or unstable flange, soft subfloor, significant leakage, or a drain condition that has not been evaluated.",
        "mistakes": "Common problems include buying the wrong rough-in, lifting without help, damaging finished flooring, failing to inspect the flange and subfloor, using an incompatible or disturbed seal, rocking the bowl to force alignment, overtightening porcelain, reusing questionable supply components, and missing slow leaks.",
        "diy": "DIY may be reasonable when the replacement matches the rough-in, the shutoff works, the flange and floor are sound, safe lifting help is available, and the installer can set and test the fixture without forcing components.",
        "pro": "Professional help may be appropriate for damaged or incorrectly positioned flanges, soft or water-damaged flooring, drain blockage or movement, unreliable shutoffs, persistent leaks or odors, fixture incompatibility, or any condition that prevents a stable installation.",
        "seo_title": "How to Replace a Toilet | MyHomeBro",
        "seo_description": "Plan toilet removal and replacement with rough-in measurement, flange and floor checks, safe lifting, sealing, testing, and professional-help guidance.",
        "faqs": [
            {"question": "What toilet rough-in size do I need?", "answer": "Measure from the finished wall surface—not the baseboard—to the closet-bolt centerline, then compare the measurement and room clearances with the toilet manufacturer's specifications."},
            {"question": "Can I install a toilet over a damaged flange?", "answer": "Do not continue over a badly damaged, loose, or unstable flange. The flange and supporting floor need an appropriate repair before the toilet is set."},
            {"question": "How tight should the toilet bolts be?", "answer": "The toilet should be secured according to manufacturer instructions without rocking, but porcelain can crack if hardware is overtightened or tightened unevenly."},
            {"question": "When should a toilet leak be evaluated professionally?", "answer": "Seek help for recurring base leaks, an unstable flange or floor, persistent drain problems or odors, a shutoff that will not isolate water, or leakage you cannot identify and stop."},
        ],
        "milestones": [
            ("Measure & Select Compatible Fixture", "Confirm rough-in, finished-wall reference, clearances, toilet specifications, shutoff and supply condition, lifting plan, and disposal plan.", "planning", 1),
            ("Isolate, Drain & Remove", "Turn off and verify water, drain the fixture, disconnect supply, remove hardware, and lift out the toilet without damaging surrounding surfaces.", "removal", 2),
            ("Inspect Flange, Drain & Floor", "Review flange stability and height, fasteners, drain opening, and surrounding floor; stop for appropriate repair when conditions are unsound.", "inspection", 3),
            ("Set, Secure & Reconnect", "Install a compatible seal, lower the fixture evenly, secure it without overtightening, confirm stability, and reconnect a serviceable supply.", "installation", 4),
            ("Fill, Flush & Inspect", "Restore water gradually, test filling and multiple flushes, inspect the supply and base, verify stability, and complete cleanup.", "testing", 5),
        ],
    },
    {
        "key": "bathroom:install_shower_door",
        "aliases": {"shower door", "glass shower door", "shower enclosure", "install shower door"},
        "name": "Install Shower Door",
        "public_title": "Install Shower Door",
        "slug": "install-shower-door",
        "project_type": "Remodel",
        "project_subtype": "Shower Door Installation",
        "difficulty": "advanced",
        "days": (1, 3),
        "summary": "Plan a framed, semi-frameless, or frameless shower-door installation around precise measurements, opening condition, mounting support, safe glass handling, alignment, sealing, cure time, and leak testing.",
        "intro": "Shower-door difficulty varies significantly by system. Framed products may tolerate more adjustment; semi-frameless systems depend on controlled hardware and glass alignment; frameless or custom systems often require professional measurement, verified support, and specialized handling. The selected product must match the opening, wall material, curb or tub, and allowable out-of-plumb conditions.",
        "scope": "Identify the door type; measure the opening at required points; assess wall plumb, curb or tub level, opening geometry, wall material, and mounting support; confirm product tolerances; follow the manufacturer's layout and installation sequence; install track or hardware without compromising surrounding assemblies; handle and align glass safely; fit seals and sweeps; apply specified sealant; observe cure requirements; and leak-test without exceeding product guidance.",
        "materials": "Materials are system-specific and may include the approved door or enclosure kit, tracks, wall channels, hinges, handles, anchors or fasteners approved for the substrate and support, setting blocks, seals, sweeps, and manufacturer-specified silicone or sealant. Do not substitute hardware casually.",
        "tools": "Tools depend on the door system and wall material. Common planning tools include an accurate tape, level, straightedge, and product instructions. Installation may require manufacturer-specified layout, drilling, fastening, glass-handling, and sealant tools. Select methods for the actual tile, stone, panel, tub, curb, glass, and backing conditions.",
        "cost": "Cost depends on framed, semi-frameless, or frameless construction; stock versus custom sizing; glass thickness and finish; opening geometry; support and wall materials; hardware; measurement services; delivery; installation labor; and corrective work. Custom glass should not be ordered from assumed dimensions.",
        "preparation": "Obtain the exact product instructions before drilling. Measure the opening in every location the manufacturer requires; check plumb, level, curb or tub slope, wall finish, and clearance; confirm backing or approved anchoring; verify that waterproofed surfaces are complete and cured; protect the area; and plan safe transport and handling of every glass panel.",
        "safety": "Glass is heavy and breakable. Do not encourage or attempt unsafe solo handling of large panels. Use appropriate PPE, handling equipment, and assistance. Tempered glass edges and corners require careful protection. Do not improvise drilling through tile, stone, panels, tubs, curbs, or waterproofed assemblies; methods vary by material and system. Stop when support, substrate, measurements, or glass condition are uncertain.",
        "mistakes": "Common problems include ordering from one measurement, ignoring out-of-plumb walls, choosing a system outside its adjustment range, assuming backing exists, using inappropriate drilling or fastening methods, damaging waterproofing, mishandling glass edges, reversing sealant locations, misaligning doors, using the enclosure before sealant cures, and leak-testing before the system is ready.",
        "diy": "DIY may be reasonable for some stock framed systems when the opening is within product tolerances, wall conditions and support are known, manufacturer instructions are clear, suitable tools are available, and glass can be handled safely with adequate help.",
        "pro": "Professional measurement and installation may be appropriate for frameless or custom glass, large or heavy panels, out-of-plumb openings, uncertain support, complex tile or stone drilling, waterproofing concerns, unusual curb or tub conditions, or any installation outside the product's stated tolerances.",
        "seo_title": "Shower Door Installation Guide | MyHomeBro",
        "seo_description": "Compare shower-door types and plan measurements, support, glass handling, alignment, sealing, cure time, leak testing, and professional installation.",
        "faqs": [
            {"question": "Can I install a shower door if the walls are not plumb?", "answer": "It depends on the measured condition and the specific product's adjustment range. Do not assume hardware can correct an opening outside the manufacturer's tolerances."},
            {"question": "What is the difference between framed and frameless shower doors?", "answer": "Framed systems use perimeter framing for more of the support and adjustment. Semi-frameless and frameless systems expose more glass and generally demand tighter measurement, support, alignment, and handling."},
            {"question": "Can one person install a glass shower door?", "answer": "Large glass panels can be heavy, awkward, and vulnerable at their edges. Do not handle them alone when the product weight, size, or instructions call for additional people or equipment."},
            {"question": "When can I leak-test the door?", "answer": "Follow the sealant and door manufacturer's cure and testing instructions. Testing or using the enclosure too early can disturb seals and invalidate the result."},
        ],
        "milestones": [
            ("Identify System & Verify Opening", "Confirm framed, semi-frameless, or frameless system; take required measurements; assess plumb, level, clearance, wall material, support, and product tolerances.", "planning", 1),
            ("Prepare Layout & Safe Handling", "Review manufacturer instructions, protect finishes, mark only approved locations, stage system-specific tools, and arrange safe glass handling assistance.", "site_preparation", 2),
            ("Install Track or Mounting Hardware", "Install specified channels, track, hinges, or supports using methods approved for the actual substrate, backing, and waterproofed assembly.", "installation", 3),
            ("Set, Align & Fit Glass", "Handle panels safely, protect edges, align doors and gaps, fit handles, seals, and sweeps, and verify controlled operation.", "glass_installation", 4),
            ("Seal, Cure & Leak-Test", "Apply sealant only where specified, observe cure time, test after the system is ready, and correct alignment or leakage without unsafe improvisation.", "testing", 5),
        ],
    },
]


def _find_existing(ProjectTemplate, spec):
    keyed = ProjectTemplate.objects.filter(
        is_system=True, benchmark_match_key=spec["key"]
    ).first()
    if keyed:
        return keyed
    for template in ProjectTemplate.objects.filter(is_system=True).order_by("id"):
        if template.name.strip().lower() in spec["aliases"]:
            return template
    return None


def prepare_bathroom_content(apps, schema_editor):
    ProjectTemplate = apps.get_model("projects", "ProjectTemplate")
    Milestone = apps.get_model("projects", "ProjectTemplateMilestone")
    templates = {}

    for spec in TEMPLATES:
        template = _find_existing(ProjectTemplate, spec)
        if template is None:
            template = ProjectTemplate.objects.create(
                name=spec["name"],
                is_system=True,
                is_system_template=True,
                is_published=True,
                is_active=True,
            )

        values = {
            "name": template.name if spec["key"] == "remodel:bathroom_remodel" else spec["name"],
            "project_type": spec["project_type"],
            "project_subtype": spec["project_subtype"],
            "description": spec["summary"],
            "default_scope": spec["scope"],
            "project_materials_hint": spec["materials"],
            "estimated_days": spec["days"][1],
            "benchmark_match_key": spec["key"],
            "public_title": spec["public_title"],
            "public_category_slug": CATEGORY,
            "public_slug": spec["slug"],
            "public_publication_status": "ready_for_review",
            "public_summary": spec["summary"],
            "public_intro": spec["intro"],
            "difficulty": spec["difficulty"],
            "estimated_duration_min_days": spec["days"][0],
            "estimated_duration_max_days": spec["days"][1],
            "cost_guidance": spec["cost"],
            "tools_guidance": spec["tools"],
            "preparation": spec["preparation"],
            "safety_guidance": spec["safety"],
            "common_mistakes": spec["mistakes"],
            "diy_guidance": spec["diy"],
            "pro_guidance": spec["pro"],
            "public_faqs": spec["faqs"],
            "seo_title": spec["seo_title"],
            "seo_description": spec["seo_description"],
            "social_image": "",
            "is_featured_public": spec["key"] == "remodel:bathroom_remodel",
            "public_published_at": None,
            "public_reviewed_at": None,
            "public_reviewed_by_id": None,
        }
        for field, value in values.items():
            setattr(template, field, value)
        template.save(update_fields=list(values))

        template.milestones.all().delete()
        for title, description, normalized_type, order in spec["milestones"]:
            Milestone.objects.create(
                template=template,
                title=title,
                description=description,
                sort_order=order,
                normalized_milestone_type=normalized_type,
            )
        templates[spec["key"]] = template

    hub = templates["remodel:bathroom_remodel"]
    vanity = templates["bathroom:replace_vanity"]
    faucet = templates["bathroom:replace_faucet"]
    toilet = templates["bathroom:replace_toilet"]
    shower = templates["bathroom:install_shower_door"]
    hub.related_public_templates.set([vanity, faucet, toilet, shower])
    vanity.related_public_templates.add(hub, faucet)
    faucet.related_public_templates.add(hub, vanity)
    toilet.related_public_templates.add(hub)
    shower.related_public_templates.add(hub)


class Migration(migrations.Migration):
    dependencies = [("projects", "0320_seed_bathroom_improvement_cluster")]
    operations = [
        migrations.RunPython(
            prepare_bathroom_content,
            migrations.RunPython.noop,
        )
    ]
