import { Request, Response } from "express";
import axios, { type AxiosError } from "axios";
import { W3IDBuilder } from "w3id";
import { signAsProvisioner } from "../core/utils/provisioner-signer";

const USER_PROFILE_ONTOLOGY = "550e8400-e29b-41d4-a716-446655440000";

interface CreateVaultRequest {
    ename: string;
    displayName?: string;
    bio?: string;
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

function graphqlUrl(): string {
    const uri = process.env.PUBLIC_EVAULT_SERVER_URI;
    if (!uri) {
        throw new Error("PUBLIC_EVAULT_SERVER_URI not set");
    }
    return new URL("/graphql", uri).toString();
}

export class AdminController {
    /**
     * Get a platform certification token from the registry so the admin can
     * authorize GraphQL writes on behalf of any eName (same mechanism the
     * provisioner uses for binding documents / profile updates).
     */
    private async getPlatformToken(): Promise<string> {
        const { registryUrl } = registryConfig();
        const platformName = process.env.PLATFORM_NAME ?? "provisioner";
        const res = await axios.post(
            new URL("/platforms/certification", registryUrl).toString(),
            { platform: platformName },
            { headers: { "Content-Type": "application/json" } },
        );
        const token = res.data?.token;
        if (!token) {
            throw new Error("Registry did not return a platform token");
        }
        return token as string;
    }

    private async gqlRequest<T>(
        ename: string,
        token: string,
        query: string,
        variables: Record<string, unknown>,
    ): Promise<T> {
        const response = await axios.post(
            graphqlUrl(),
            { query, variables },
            {
                headers: {
                    "Content-Type": "application/json",
                    "X-ENAME": ename,
                    Authorization: `Bearer ${token}`,
                },
            },
        );
        if (response.data?.errors?.length) {
            throw new Error(response.data.errors[0].message);
        }
        return response.data?.data as T;
    }

    /**
     * Mirror of the eID wallet's UserProfile upsert (see evault.ts): creates a
     * UserProfile MetaEnvelope for the freshly registered eName.
     */
    private async createUserProfileInEvault(
        ename: string,
        displayName: string,
        bio: string | null,
        token: string,
    ): Promise<string> {
        const now = new Date().toISOString();
        const payload = {
            username: ename.replace("@", ""),
            displayName,
            bio,
            avatarUrl: null,
            bannerUrl: null,
            ename,
            isVerified: false,
            isPrivate: false,
            createdAt: now,
            updatedAt: now,
            isArchived: false,
        };
        const result = await this.gqlRequest<{
            createMetaEnvelope: {
                metaEnvelope: { id: string } | null;
                errors: { message: string }[] | null;
            };
        }>(
            ename,
            token,
            `mutation CreateMetaEnvelope($input: MetaEnvelopeInput!) {
                createMetaEnvelope(input: $input) {
                    metaEnvelope { id }
                    errors { message }
                }
            }`,
            {
                input: {
                    ontology: USER_PROFILE_ONTOLOGY,
                    payload,
                    acl: ["*"],
                },
            },
        );
        const errors = result.createMetaEnvelope?.errors;
        if (errors?.length) {
            throw new Error(
                `UserProfile create failed: ${errors[0].message}`,
            );
        }
        const id = result.createMetaEnvelope?.metaEnvelope?.id;
        if (!id) {
            throw new Error("UserProfile create returned no envelope id");
        }
        return id;
    }

    /**
     * Mirror of the eID wallet's "self" binding document (onboarding name
     * step): signs the doc with the provisioner key instead of the user key,
     * which the binding-document service accepts.
     */
    private async createSelfBindingDocument(
        ename: string,
        displayName: string,
        token: string,
    ): Promise<string> {
        const subject = ename.startsWith("@") ? ename : `@${ename}`;
        const data = { kind: "self", name: displayName };
        const ownerSignature = signAsProvisioner({
            subject,
            type: "self",
            data: data as any,
        });
        const result = await this.gqlRequest<{
            createBindingDocument: {
                metaEnvelopeId: string | null;
                errors: { message: string }[] | null;
            };
        }>(
            subject,
            token,
            `mutation CreateBindingDocument($input: CreateBindingDocumentInput!) {
                createBindingDocument(input: $input) {
                    metaEnvelopeId
                    errors { message }
                }
            }`,
            {
                input: {
                    subject,
                    type: "self",
                    data,
                    ownerSignature,
                },
            },
        );
        const errors = result.createBindingDocument?.errors;
        if (errors?.length) {
            throw new Error(
                `Self binding document failed: ${errors[0].message}`,
            );
        }
        const id = result.createBindingDocument?.metaEnvelopeId;
        if (!id) {
            throw new Error("Self binding document returned no envelope id");
        }
        return id;
    }

    registerRoutes(app: any) {
        /**
         * POST /admin/evault
         * JSON: { ename: string, displayName?: string, bio?: string }
         *
         * Registers a new eVault for the given ename in the registry, then
         * populates it with the same artifacts the eID wallet creates during
         * onboarding: a UserProfile MetaEnvelope and a "self" binding document
         * carrying the user's display name.
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

                    const displayName =
                        typeof req.body?.displayName === "string" &&
                        req.body.displayName.trim()
                            ? req.body.displayName.trim()
                            : ename;
                    const bio =
                        typeof req.body?.bio === "string" &&
                        req.body.bio.trim()
                            ? req.body.bio.trim()
                            : null;

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

                    // Populate the eVault like the eID wallet does. Profile and
                    // binding document require a platform token; createMetaEnvelope
                    // alone would work with just X-ENAME but createBindingDocument
                    // needs a valid Bearer token.
                    let profileCreated = false;
                    let bindingDocumentCreated = false;
                    try {
                        const token = await this.getPlatformToken();
                        await this.createUserProfileInEvault(
                            ename,
                            displayName,
                            bio,
                            token,
                        );
                        profileCreated = true;
                        await this.createSelfBindingDocument(
                            ename,
                            displayName,
                            token,
                        );
                        bindingDocumentCreated = true;
                    } catch (fillError) {
                        console.error(
                            "[ADMIN] Failed to populate eVault data:",
                            fillError,
                        );
                        return res.status(500).json({
                            success: false,
                            error:
                                fillError instanceof Error
                                    ? fillError.message
                                    : String(fillError),
                            registered: created.data,
                        });
                    }

                    return res.status(created.status).json({
                        ...(created.data ?? {}),
                        displayName,
                        profileCreated,
                        bindingDocumentCreated,
                    });
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
