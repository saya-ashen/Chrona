/** Written by the kernel (v2-30 §4), never typed on the page. */
export const kernelField = (field: string) => /^(refreshToken|scope|oauthBinding)(_|$)/.test(field) || field === "oauthManaged";
