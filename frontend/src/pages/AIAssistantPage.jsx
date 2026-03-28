import React from 'react';

import PageShell from '../components/PageShell.jsx';
import StartWithAIAssistant from '../components/StartWithAIAssistant.jsx';

export default function AIAssistantPage() {
  return (
    <PageShell
      title="Start with AI"
      subtitle="Prompt-first guidance into leads, agreements, templates, milestones, and navigation."
      showLogo
    >
      <StartWithAIAssistant mode="page" />
    </PageShell>
  );
}
