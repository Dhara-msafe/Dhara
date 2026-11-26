import React, { useEffect, useState } from 'react';
import WorkflowScreen from '@/src/visitor/WorkflowScreen';
import { loadVisitorSession } from '@/src/visitor/session';
import { CYBER_FRAUD_STEPS } from '@/src/visitor/content';

export default function CyberFraudScreen() {
  const [lc, setLc] = useState('en');
  useEffect(() => { loadVisitorSession().then(s => s && setLc(s.touristLang.code)); }, []);
  return (
    <WorkflowScreen
      headerColor="#8A6A1E"
      headerIcon="shield-outline"
      headerTitle="Cyber Fraud Help"
      headerSub="Scam, online fraud, financial theft"
      steps={CYBER_FRAUD_STEPS}
      langCode={lc}
      footnote="Call 1930 immediately for financial fraud — banks can freeze transactions within hours."
    />
  );
}
