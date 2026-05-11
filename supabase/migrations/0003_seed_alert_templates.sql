-- =============================================================================
-- Hagerstone Design PMS — Alert Templates Seed
-- All Maytapi message bodies live here, never hard-coded in n8n nodes.
-- Variables use {variable_name} mustache-style syntax.
-- =============================================================================

INSERT INTO design_alert_templates (key, body, variables) VALUES

-- Stage 4: Founder notified when BOQ is ready for review
('stage4_founder_review_pending',
 'Hi {founder_name}, a new project BOQ is waiting for your review.\n\nProject: {project_name}\nClient: {client_name}\nDesigner: {designer_name}\n\nPlease log in at {portal_url} to review the BOQ and set the budget.',
 ARRAY['founder_name','project_name','client_name','designer_name','portal_url']),

-- Stage 4: Founder requested revision
('stage4_revision_requested',
 'Hi {designer_name}, the Founder has reviewed the BOQ for *{project_name}* and has requested revisions.\n\nComments: {comments}\n\nPlease update the BOQ and re-submit.',
 ARRAY['designer_name','project_name','comments']),

-- Stage 10: Founder final approval
('stage10_final_approved',
 'Project *{project_name}* has been given final approval by the Founder.\n\nBudget: {budget_amount}\nHandoff to CPS is now being initiated.',
 ARRAY['project_name','budget_amount']),

-- CPS over-spend alert
('cps_overspend_alert',
 'ALERT: Over-budget on *{project_name}*\n\nLine item: {item_name}\nBudgeted: {budgeted_amount}\nActual: {actual_amount}\nOvershoot: {overshoot_amount}\nVendor: {vendor_name}\n\nPO: {cps_po_id}',
 ARRAY['project_name','item_name','budgeted_amount','actual_amount','overshoot_amount','vendor_name','cps_po_id']),

-- Stage 11: Handoff to CPS complete
('stage11_handoff_complete',
 'Project *{project_name}* has been handed off to CPS for procurement.\n\nCPS Project ID: {cps_project_id}\nInternal BOQ Version: {boq_version}',
 ARRAY['project_name','cps_project_id','boq_version']),

-- Meeting reminder (same-day)
('meeting_reminder_sameday',
 'Reminder: Client meeting for *{project_name}* is scheduled today at {meeting_time}.\n\nAttendees: {attendees}',
 ARRAY['project_name','meeting_time','attendees']),

-- Client: welcome to portal
('client_portal_welcome',
 'Hi {client_name}, you have been given access to the Hagerstone Design portal for project *{project_name}*.\n\nUse the link below to log in and review your design proposal:\n{portal_url}',
 ARRAY['client_name','project_name','portal_url'])

ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, variables = EXCLUDED.variables;
