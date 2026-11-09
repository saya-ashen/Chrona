export function invalid(message: string): never { throw Object.assign(new Error(message), { code: "invalid" }); }
export function forbidden(message = "This action requires the real owner"): never { throw Object.assign(new Error(message), { code: "forbidden" }); }
export function capacity(message: string): never { throw Object.assign(new Error(message), { code: "capacity" }); }
export function conflict(message: string): never { throw Object.assign(new Error(message), { code: "conflict" }); }
