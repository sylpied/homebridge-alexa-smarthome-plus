export interface AlexaRoutine {
  automationId: string;
  name: string;
  status?: string;
  sequence?: unknown;
  [key: string]: unknown;
}

export interface AlexaRoutineResponse {
  automations?: AlexaRoutine[];
  routines?: AlexaRoutine[];
}

export const extractAlexaRoutines = (
  response: AlexaRoutine[] | AlexaRoutineResponse,
): AlexaRoutine[] => {
  if (Array.isArray(response)) {
    return response;
  }

  if (Array.isArray(response.automations)) {
    return response.automations;
  }

  return Array.isArray(response.routines) ? response.routines : [];
};
