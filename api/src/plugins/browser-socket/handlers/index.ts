export { logsHandler } from "./logs.handler.js";
// export { castHandler } from "./cast.handler.js";
export { webRTCHandler } from "./webrtc.handler.js";
export { pageIdHandler } from "./pageId.handler.js";
export { recordingHandler } from "./recording.handler.js";

import { WebSocketHandler } from "../../../types/websocket.js";
import { logsHandler } from "./logs.handler.js";
// import { castHandler } from "./cast.handler.js";
import { webRTCHandler } from "./webrtc.handler.js";
import { pageIdHandler } from "./pageId.handler.js";
import { recordingHandler } from "./recording.handler.js";

export const defaultHandlers: WebSocketHandler[] = [
  logsHandler,
  // castHandler,
  webRTCHandler,
  pageIdHandler,
  recordingHandler,
];
