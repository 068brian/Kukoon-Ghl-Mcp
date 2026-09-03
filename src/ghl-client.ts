import axios, { AxiosInstance } from "axios";
import { config } from "./config.js";

/**
 * Thin wrapper around the GoHighLevel v2 API.
 *
 * IMPORTANT: This client is read-only by construction. It only exposes
 * `get()`. There is no post/put/patch/delete method here on purpose —
 * if a tool needs a write, that's a signal the tool shouldn't exist in
 * this server. Keeping the write verbs off the client entirely means a
 * bug in a tool's logic can't accidentally mutate Kukoon's CRM.
 */
class GhlClient {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: config.ghlBaseUrl,
      headers: {
        Authorization: `Bearer ${config.ghlPrivateToken}`,
        Version: config.ghlApiVersion,
        Accept: "application/json",
      },
      timeout: 15000,
    });
  }

  /**
   * No parameter is auto-injected here (not even locationId) — GHL's v2 API
   * is inconsistent about whether a given endpoint wants `locationId`
   * (camelCase, most endpoints) or `location_id` (snake_case, notably
   * /opportunities/search). Auto-injecting one convention silently broke
   * whichever endpoints expected the other. Every call site below passes
   * the correct parameter name explicitly for its specific endpoint.
   */
  async get<T = any>(path: string, params: Record<string, any> = {}): Promise<T> {
    try {
      const res = await this.http.get<T>(path, { params });
      return res.data;
    } catch (err: any) {
      const status = err?.response?.status;
      const body = err?.response?.data;
      const message = body?.message ?? JSON.stringify(body) ?? err.message;
      throw new Error(`GHL API error (${status ?? "network"}): ${message}`);
    }
  }
}

export const ghl = new GhlClient();
