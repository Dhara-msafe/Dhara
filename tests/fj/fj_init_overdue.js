
(() => {
 try {
  const s = window.localStorage;
  s.setItem('gk_token', "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0NjU3NTRjYS0xNTMyLTQ1MDEtOTYyZi1iYzZkNjQyYjI4ZjIiLCJleHAiOjE3OTY2NjEwMTB9.j0T88bPn7aMgQMX1U5TqgMlo5aI6L9BYjwl7c1Mv8sQ");
  s.setItem('gk_user', "{\"id\": \"465754ca-1532-4501-962f-bc6d642b28f2\", \"email\": \"voicetest2026@example.com\", \"name\": \"QA Tester\", \"phone\": \"9999999999\", \"language\": \"en\", \"state\": null, \"state_name\": \"\", \"is_pro\": false, \"pro_since\": null, \"pro_samples_used\": 0, \"pro_samples_limit\": 5, \"pro_samples_remaining\": 5, \"drafts_used\": 1, \"drafts_free_limit\": 1, \"drafts_remaining\": 0, \"is_grandfathered\": true, \"state_jurisdiction\": \"\", \"terms_accepted\": true, \"terms_version\": \"2026-10-01\", \"terms_accepted_at\": \"2026-09-23T21:02:57.079503+00:00\", \"photo_url\": null, \"photo_visibility\": \"only_me\"}");
  s.setItem('gk_lang', '"en"');
  s.setItem('lang_onboarded_v1_465754ca-1532-4501-962f-bc6d642b28f2', '1');
  s.setItem('ws_panic_lesson_seen', '1');
  s.setItem('ws_trusted_circle_legacy_quarantined_v1', '1');
  if (!s.getItem('ws_trusted_circle_465754ca-1532-4501-962f-bc6d642b28f2')) s.setItem('ws_trusted_circle_465754ca-1532-4501-962f-bc6d642b28f2', "[{\"id\": \"c1\", \"name\": \"TEST_Asha\", \"phone\": \"9000000001\"}, {\"id\": \"c2\", \"name\": \"TEST_Ravi\", \"phone\": \"9000000002\"}]");
 } catch(e) {}
 window.__opened = []; window.__alerts = [];
 window.open = function(u){ window.__opened.push(String(u)); return null; };
 window.alert = function(m){ window.__alerts.push(String(m)); };
})();

(() => {
 try {
  const s = window.localStorage; const k = 'fj_journey_v1_465754ca-1532-4501-962f-bc6d642b28f2';
  if (!s.getItem(k)) {
   const now = Date.now();
   const mk = (id,name,phone,a,m,h) => ({id,name,phone,source:'device',arrival:a,missedCheckin:m,helpRequest:h});
   s.setItem(k, JSON.stringify({id:'fj_test_'+now, destination:'TEST_Library', departAt:'5:00 PM', arriveAt:'5:30 PM', returnAt:'8:00 PM', checkinMins:30,
     contacts:[mk('device:c1','TEST_Asha','9000000001',true,true,true), mk('device:c2','TEST_Ravi','9000000002',true,false,false)],
     status:'active', startedAt: now - 45*60000, lastCheckinAt:null, arrivedAt:null, helpRequestedAt:null, endedAt:null}));
  }
 } catch(e) {}
})();
