import React, { useEffect, useState } from 'react';
import WorkflowScreen from '@/src/visitor/WorkflowScreen';
import { loadVisitorSession } from '@/src/visitor/session';
import { VISA_FRRO_STEPS } from '@/src/visitor/content';

export default function VisaFRROScreen() {
  const [lc, setLc] = useState('en');
  useEffect(() => { loadVisitorSession().then(s => s && setLc(s.touristLang.code)); }, []);
  return (
    <WorkflowScreen
      headerColor="#1E5BD0"
      headerIcon="calendar-outline"
      headerTitle="Visa / FRRO Guide"
      headerSub="e-Visa, extension, overstay recovery"
      steps={VISA_FRRO_STEPS}
      langCode={lc}
      footnote="DHARA provides general guidance. Consult the FRRO or a registered lawyer for your specific case."
    />
  );
}
