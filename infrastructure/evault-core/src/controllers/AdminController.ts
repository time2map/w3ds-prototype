import { Request, Response } from "express";
import axios, { type AxiosError } from "axios";
import { W3IDBuilder } from "w3id";

interface CreateVaultRequest {
    ename: string;
}

function normalizeEname(raw: unknown): string {
    const trimmed =
        typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
    if (!trimmed) {
        throw new Error("ename is required");
    }
    return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function registryConfig() {
    const registryUrl = process.env.PUBLIC_REGISTRY_URL;
    const secret = process.env.REGISTRY_SHARED_SECRET;
    if (!registryUrl || !secret) {
        throw new Error("PUBLIC_REGISTRY_URL or REGISTRY_SHARED_SECRET not set");
    }
    return { registryUrl, secret };
}

export class AdminController {
    registerRoutes(app: any) {
        /**
         * POST /admin/evault
         * JSON: { ename: string }
         *
         * Registers a new eVault for the given ename in the registry.
         * Generates a fresh evault W3ID and reuses PUBLIC_EVAULT_SERVER_URI,
         * mirroring the provisioning flow.
         */
        app.post(
            "/admin/evault",
            async (req: Request<{}, {}, CreateVaultRequest>, res: Response) => {
                try {
                    let ename: string;
                    try {
                        ename = normalizeEname(req.body?.ename);
                    } catch (err) {
                        return res.status(400).json({
                            success: false,
                            error:
                                err instanceof Error
                                    ? err.message
                                    : String(err),
                        });
                    }

                    const { registryUrl, secret } = registryConfig();
                    const uri = process.env.PUBLIC_EVAULT_SERVER_URI;
                    if (!uri) {
                        return res.status(500).json({
                            success: false,
                            error: "PUBLIC_EVAULT_SERVER_URI not set",
                        });
                    }

                    const { data: existing } = await axios.get(
                        new URL("/list", registryUrl).toString(),
                    );
                    if (
                        Array.isArray(existing) &&
                        existing.some(
                            (v: any) =>
                                typeof v?.ename === "string" &&
                                v.ename === ename,
                        )
                    ) {
                        return res.status(409).json({
                            success: false,
                            error: `eVault for ${ename} already exists`,
                        });
                    }

                    const evaultId = await new W3IDBuilder()
                        .withGlobal(true)
                        .build();
                    const created = await axios.post(
                        new URL("/register", registryUrl).toString(),
                        { ename, uri, evault: evaultId.id },
                        {
                            headers: {
                                Authorization: `Bearer ${secret}`,
                            },
                        },
                    );
                    return res.status(created.status).json(created.data);
                } catch (error) {
                    const axiosError = error as AxiosError;
                    console.error(
                        "[ADMIN] Create eVault error:",
                        axiosError.response?.data ?? axiosError.message,
                    );
                    const status = axiosError.response?.status ?? 500;
                    return res.status(status).json({
                        success: false,
                        error:
                            axiosError.response?.data ??
                            (error instanceof Error
                                ? error.message
                                : String(error)),
                    });
                }
            },
        );

        /**
         * DELETE /admin/evault?ename=<ename>
         *
         * Removes every registered eVault entry for the given ename from the
         * registry. A missing registration is treated as success.
         */
        app.delete(
            "/admin/evault",
            async (req: Request, res: Response) => {
                try {
                    let ename: string;
                    try {
                        ename = normalizeEname(req.query.ename);
                    } catch (err) {
                        return res.status(400).json({
                            success: false,
                            error:
                                err instanceof Error
                                    ? err.message
                                    : String(err),
                        });
                    }

                    const { registryUrl, secret } = registryConfig();

                    const { data: existing } = await axios.get(
                        new URL("/list", registryUrl).toString(),
                    );
                    const matching: any[] = Array.isArray(existing)
                        ? existing.filter(
                              (v: any) =>
                                  typeof v?.ename === "string" &&
                                  v.ename === ename,
                          )
                        : [];

                    for (const v of matching) {
                        await axios.delete(
                            new URL("/register", registryUrl).toString(),
                            {
                                params: { ename: v.ename },
                                headers: {
                                    Authorization: `Bearer ${secret}`,
                                },
                            },
                        );
                    }

                    return res.status(200).json({
                        success: true,
                        message: `Deleted ${matching.length} eVault(s) for ${ename}`,
                    });
                } catch (error) {
                    const axiosError = error as AxiosError;
                    console.error(
                        "[ADMIN] Delete eVault error:",
                        axiosError.response?.data ?? axiosError.message,
                    );
                    const status = axiosError.response?.status ?? 500;
                    return res.status(status).json({
                        success: false,
                        error:
                            axiosError.response?.data ??
                            (error instanceof Error
                                ? error.message
                                : String(error)),
                    });
                }
            },
        );
    }
}
