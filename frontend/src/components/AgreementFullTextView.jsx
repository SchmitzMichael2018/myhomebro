import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import api from '../api';
import { UploadCloud } from 'lucide-react';

export default function AgreementFullTextView({ agreement, onOpenLegal, onUpdate }) {
    const { project, milestones = [], total_cost } = agreement;
    
    const [addendumFile, setAddendumFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);

    const handleFileChange = (e) => setAddendumFile(e.target.files[0]);

    const handleUploadAddendum = async () => {
        if (!addendumFile) return toast.error("Please select a file.");
        setIsUploading(true);
        const formData = new FormData();
        formData.append("addendum_file", addendumFile);

        try {
            await api.post(`/agreements/${agreement.id}/upload-addendum/`, formData);
            toast.success("Addendum uploaded!");
            setAddendumFile(null);
            if (onUpdate) onUpdate();
        } catch (err) {
            toast.error(err.response?.data?.detail || "Upload failed.");
        } finally {
            setIsUploading(false);
        }
    };
    
    const costDisplay = parseFloat(total_cost || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    const starts = milestones.map(m => m.start_date ? parseISO(m.start_date) : null).filter(Boolean);
    const ends = milestones.map(d => d.end ? parseISO(d.end) : null).filter(Boolean);
    const overallStart = starts.length ? format(new Date(Math.min(...starts)), 'PPPP') : 'N/A';
    const overallEnd = ends.length ? format(new Date(Math.max(...ends)), 'PPPP') : 'N/A';

    return (
        <div className="space-y-8 prose max-w-none p-1">
            {/* --- FIX: Restored missing JSX for Sections 1, 2, and 3 --- */}
            <section>
                <h2>1. Parties to this Agreement</h2>
                <p><strong>Contractor:</strong> {project.contractor.name} (<em>{project.contractor.email}</em>)</p>
                <p><strong>Homeowner:</strong> {project.homeowner.full_name} (<em>{project.homeowner.email}</em>)</p>
            </section>

            <section>
                <h2>2. Project Details</h2>
                <p><strong>Title:</strong> {project.title || 'N/A'}</p>
                <p>
                    <strong>Location:</strong>{' '}
                    {[
                        project.project_street_address,
                        project.project_address_line_2,
                        project.project_city,
                        project.project_state,
                        project.project_zip_code
                    ].filter(Boolean).join(', ') || 'N/A'}
                </p>
                <p><strong>Estimated Cost:</strong> {costDisplay}</p>
                <p><strong>Timeline:</strong> {overallStart} – {overallEnd}</p>
            </section>

            {milestones.length > 0 && (
                <section>
                    <h2>3. Milestones &amp; Schedule</h2>
                    <ol className="list-decimal ml-5">
                        {milestones.map(m => (
                            <li key={m.id} className="mb-4">
                                <p><strong>{m.title}</strong> ({m.start_date} – {m.completion_date})</p>
                                {m.description && <p>{m.description}</p>}
                                <p><strong>Amount:</strong> ${parseFloat(m.amount).toFixed(2)}</p>
                            </li>
                        ))}
                    </ol>
                </section>
            )}

            <section>
                <h2>4. Legal Documents</h2>
                <p>This agreement incorporates by reference the full Terms of Service and Privacy Policy.</p>
                <ul className="list-disc ml-5 space-y-2 not-prose">
                    <li>
                        <button type="button" className="text-blue-600 hover:underline inline-flex items-center" onClick={() => onOpenLegal('terms_of_service')}>
                             View Summarized Terms (Web)
                        </button>
                    </li>
                    <li>
                        <a href="/static/legal/Full_terms_of_service.pdf" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center">
                            Download Full Binding Terms PDF
                        </a>
                    </li>
                    <li>
                        <button type="button" className="text-blue-600 hover:underline inline-flex items-center" onClick={() => onOpenLegal('privacy_policy')}>
                            View Summarized Privacy Policy (Web)
                        </button>
                    </li>
                    <li>
                        <a href="/static/legal/Full_privacy_policy.pdf" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center">
                            Download Full Binding Privacy Policy PDF
                        </a>
                    </li>
                </ul>
            </section>

            <section>
                <h2>5. Supplemental Addendum</h2>
                <div className="not-prose p-4 border rounded-lg bg-gray-50">
                    <p className="mt-0 text-sm text-gray-700">You may upload a custom addendum PDF to append to the final agreement.</p>
                    {agreement.addendum_file && (
                        <div className="my-4">
                            <a href={agreement.addendum_file} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">
                                View Current Addendum
                            </a>
                        </div>
                    )}
                    <div className="flex items-center gap-4 mt-4">
                        <input type="file" onChange={handleFileChange} className="text-sm" accept="application/pdf" />
                        <button 
                            onClick={handleUploadAddendum} 
                            disabled={!addendumFile || isUploading}
                            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-md hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-2"
                        >
                            <UploadCloud size={16}/>
                            {isUploading ? 'Uploading...' : 'Upload'}
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
}