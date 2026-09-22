export const RESEND_SUCCESS_MESSAGE =
  "If this account is eligible, a new verification email has been sent.";

export const initialResendState = {
  status: "idle",
  message: "",
  cooldownSeconds: 0,
};

export function resendStateReducer(state, action) {
  switch (action.type) {
    case "start":
      return { ...state, status: "loading", message: "" };
    case "success":
      return {
        status: "success",
        message: action.message || RESEND_SUCCESS_MESSAGE,
        cooldownSeconds: Math.max(0, Number(action.cooldownSeconds) || 0),
      };
    case "failure":
      return {
        status: "failure",
        message:
          action.message ||
          "We could not send the email right now. Please try again later.",
        cooldownSeconds: Math.max(0, Number(action.cooldownSeconds) || 0),
      };
    case "tick":
      return {
        ...state,
        cooldownSeconds: Math.max(0, state.cooldownSeconds - 1),
      };
    default:
      return state;
  }
}
