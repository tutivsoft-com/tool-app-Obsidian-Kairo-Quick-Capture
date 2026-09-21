export class Notice {
  constructor(message) {
    this.message = message;
  }
}

export class Setting {
  constructor() {}
}

export async function requestUrl(options) {
  if (typeof globalThis.__kairoRequestUrl === "function") return globalThis.__kairoRequestUrl(options);
  throw new Error("requestUrl is not available in billing unit tests.");
}
