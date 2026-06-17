# Delay discounting

This experiment scaffolds the ADOpy delay discounting example as a jsPsych timeline.

The timeline is intentionally separated from the adaptive backend:

- `delay_discounting_timeline.js` displays trials and records data.
- `controllers/mock_ado_controller.js` lets the timeline run without Python.
- `controllers/api_ado_controller.js` calls the local ADOpy FastAPI service.

Response coding:

- `choice = 0`: smaller-sooner option
- `choice = 1`: larger-later option
