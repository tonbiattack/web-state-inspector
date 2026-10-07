# Privacy Policy — Web State Inspector

Effective date: 2026-10-07

Web State Inspector is a Chrome DevTools extension for investigating a web application's behavior. Its single purpose is to associate user actions, state changes, network activity, and errors in a DevTools timeline and to export relevant debugging context locally.

## Data the extension may process

After you select **Start Recording**, the extension may read and display information from the page you are inspecting, including:

- page URLs and route changes;
- user interactions and selected-element details;
- Local Storage, Session Storage, and cookies available to the inspected origin;
- network request and response metadata, headers, and bodies exposed by the DevTools APIs;
- JavaScript and console errors; and
- explicitly exposed, read-only diagnostic data from a page framework.

This data can contain cookies, authorization headers, tokens, request or response bodies, and personal or confidential information.

## How data is used and retained

The extension uses this data only to display debugging information in the DevTools panel and to prepare Markdown or JSON that you explicitly copy. Recording is not started until you press **Start Recording**. Data is kept in the active DevTools-panel session and can be cleared with the panel's **Clear** control or by closing DevTools. The extension does not write page storage or cookies.

## No external transfer or AI request

Web State Inspector does not operate an external server, send telemetry, show advertising, sell data, or call an AI service. **AI Export** only formats captured debugging context locally as Markdown or JSON and copies it when you explicitly request it.

After copied text is pasted into an AI service, issue tracker, chat, or any other third-party service, that service's privacy policy applies. Review and remove sensitive values before sharing.

## Chrome permissions and Limited Use

The extension requests `cookies` and access to inspected web origins only to provide the read-only Cookie Inspector for the page you opened in DevTools. It uses `webNavigation` only to record main-frame and iframe lifecycle events in the debugging timeline. Its content bridge runs in inspected pages so it can observe the user actions, route changes, storage changes, and errors that make up that timeline.

Web State Inspector's use of information received from Chrome APIs complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data), including the Limited Use requirements.

## Contact

For questions or reports, open an issue in the [Web State Inspector repository](https://github.com/tonbiattack/web-state-inspector/issues). Do not include cookies, tokens, authorization headers, full request/response bodies, or other secrets in an issue.
