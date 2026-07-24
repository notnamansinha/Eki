export interface RTDBResumeLifecycle {
  connected: boolean;
  awaitingSnapshot: boolean;
  reconnectPending: boolean;
  resumeGeneration: number;
  connectionGeneration: number;
}

export const initialRTDBResumeLifecycle: RTDBResumeLifecycle = {
  connected: false,
  awaitingSnapshot: true,
  reconnectPending: false,
  resumeGeneration: 0,
  connectionGeneration: 0,
};

export type RTDBResumeAction =
  | { type: "connection"; connected: boolean }
  | { type: "reconnect-requested" }
  | { type: "reconnect-cooldown-ended" }
  | { type: "snapshot-received" };

export function reduceRTDBResumeLifecycle(
  state: RTDBResumeLifecycle,
  action: RTDBResumeAction,
): RTDBResumeLifecycle {
  switch (action.type) {
    case "connection":
      return {
        ...state,
        connected: action.connected,
        awaitingSnapshot: action.connected
          ? state.awaitingSnapshot
          : true,
        connectionGeneration:
          action.connected && !state.connected
            ? state.connectionGeneration + 1
            : state.connectionGeneration,
      };
    case "reconnect-requested":
      if (state.reconnectPending) return state;
      return {
        ...state,
        connected: false,
        awaitingSnapshot: true,
        reconnectPending: true,
        resumeGeneration: state.resumeGeneration + 1,
      };
    case "reconnect-cooldown-ended":
      return { ...state, reconnectPending: false };
    case "snapshot-received":
      return state.connected ? { ...state, awaitingSnapshot: false } : state;
  }
}
