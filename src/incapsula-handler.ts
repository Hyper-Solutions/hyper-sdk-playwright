import { Page, BrowserContext } from 'playwright';
import { Session } from 'hyper-sdk-js';
import { Route } from "@playwright/test";
import { generateReese84Sensor, Reese84Input } from "hyper-sdk-js/incapsula/reese";
import { generateUtmvcCookie, UtmvcInput } from "hyper-sdk-js/incapsula/utmvc";

export interface IncapsulaHandlerConfig {
    session: Session;
    ipAddress: string;
    userAgent?: string;
    acceptLanguage?: string;
    scriptPathToSitekey: Map<string, string>;
}

export interface IncapsulaScriptCapture {
    interceptedPaths: string[];
    activeSitekeys: Map<string, string>;
}

export class IncapsulaHandler {
    private session: Session;
    private userAgent: string;
    private ipAddress: string;
    private acceptLanguage: string;
    private scriptPathToSitekey: Map<string, string>;
    private utmvc: string;

    // Captured data
    private scriptCapture: IncapsulaScriptCapture = {
        interceptedPaths: [],
        activeSitekeys: new Map()
    };

    // Map to store script URLs for each path
    private scriptPathToScriptUrl: Map<string, string> = new Map();

    constructor(config: IncapsulaHandlerConfig) {
        this.session = config.session;
        this.ipAddress = config.ipAddress;
        this.userAgent = config.userAgent || '';
        this.acceptLanguage = config.acceptLanguage || 'en-US,en;q=0.9';
        this.scriptPathToSitekey = config.scriptPathToSitekey;
    }

    /**
     * Initialize the handler on a Playwright page
     */
    public async initialize(page: Page, context: BrowserContext): Promise<void> {
        await this.setupRequestInterceptor(page, context);
        await this.setupResponseInterceptor(page, context);
    }

    /**
     * Set up request interceptor to handle Incapsula script requests
     */
    private async setupRequestInterceptor(page: Page, context: BrowserContext): Promise<void> {
        // Intercept Incapsula utmvc requests and abort them after reading response
        await page.route(/.*\/_Incapsula_Resource\?SWJIYLWA=.*/, async (route) => {
            const request = route.request();
            const requestUrl = request.url();

            try {
                console.log(`[IncapsulaHandler] Intercepting Incapsula utmvc request: ${requestUrl}`);

                // Get the response first
                const response = await route.fetch();
                const responseBody = await response.text();

                // Get current user agent if not set
                if (!this.userAgent) {
                    this.userAgent = await page.evaluate(() => navigator.userAgent);
                }

                // Get all cookies for the current page/domain
                const allCookies = await context.cookies();

                // Filter cookies that start with "incap_ses_"
                const incapCookies = allCookies.filter(cookie => cookie.name.startsWith('incap_ses_'));

                // Extract just the values
                const sessionIds = incapCookies.map(cookie => cookie.value);

                const result = await generateUtmvcCookie(this.session, new UtmvcInput(
                    this.userAgent,
                    responseBody,
                    sessionIds,
                ))
                this.utmvc = result.payload;

                // Inject the cookie interception code with our generated utmvc value
                await page.evaluate(`
    (function(utmvcValue) {
        const originalCookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
        let intercepted = false;

        Object.defineProperty(document, 'cookie', {
            set: function(value) {
                if (!intercepted && value.includes('___utmvc=')) {
                    console.log('[IncapsulaHandler] Intercepting ___utmvc cookie:', value);
                    const modifiedValue = value.replace(/___utmvc=([^;]+)/, \`___utmvc=\${utmvcValue}\`);
                    console.log('[IncapsulaHandler] Modified ___utmvc cookie:', modifiedValue);
                    originalCookieDescriptor.set.call(this, modifiedValue);
                    intercepted = true;
                    Object.defineProperty(document, 'cookie', originalCookieDescriptor);
                    console.log('[IncapsulaHandler] Cookie interception completed and original behavior restored');
                } else {
                    originalCookieDescriptor.set.call(this, value);
                }
            },
            get: originalCookieDescriptor.get
        });
        console.log('[IncapsulaHandler] Cookie interception injected and ready');
    })("${this.utmvc}");
`);

                console.log(`[IncapsulaHandler] Read Incapsula utmvc response (${responseBody.length} chars)`);

                await route.continue();
            } catch (error) {
                console.error('Error intercepting Incapsula utmvc request:', error);
                await route.continue();
            }
        });

        // Use a single broad pattern to catch all potential Incapsula requests
        // Then do specific path matching inside the handler
        await page.route(/.*\?.*d=.*/, async (route) => {
            const request = route.request();
            const requestUrl = request.url();

            try {
                // Check if this request matches any of our configured script paths
                const matchingScriptPath = this.findMatchingScriptPath(requestUrl);

                if (matchingScriptPath && this.shouldInterceptIncapsulaRequest(requestUrl, request.method(), matchingScriptPath)) {
                    console.log(`[IncapsulaHandler] Found matching script path: ${matchingScriptPath} for URL: ${requestUrl}`);
                    await this.handleIncapsulaRequest(route, page, context, matchingScriptPath, requestUrl);
                    return;
                }

                // Continue with normal request
                return route.continue();
            } catch (error) {
                console.error('Error in Incapsula request interceptor:', error);
                return route.continue();
            }
        });
    }

    /**
     * Set up response interceptor to capture script URLs
     */
    private async setupResponseInterceptor(page: Page, context: BrowserContext): Promise<void> {
        // Listen for responses to capture script URLs
        page.on('response', async (response) => {
            try {
                const url = response.url();
                const method = response.request().method();

                // Only interested in GET requests
                if (method !== 'GET') return;

                // Check if this response matches any of our script paths
                const matchingScriptPath = this.findMatchingScriptPath(url);

                if (matchingScriptPath) {
                    console.log(`[IncapsulaHandler] Captured script URL for path ${matchingScriptPath}: ${url}`);
                    this.scriptPathToScriptUrl.set(matchingScriptPath, url);
                }
            } catch (error) {
                console.error('Error in response interceptor:', error);
            }
        });
    }

    /**
     * Find which script path (if any) matches the given URL
     */
    private findMatchingScriptPath(requestUrl: string): string | null {
        try {
            const url = new URL(requestUrl);
            const pathname = url.pathname;

            // Check if any of our configured script paths match this URL
            for (const scriptPath of this.scriptPathToSitekey.keys()) {
                if (pathname.startsWith(scriptPath)) {
                    console.log(`[IncapsulaHandler] Path match found: ${scriptPath} matches ${pathname}`);
                    return scriptPath;
                }
            }

            return null;
        } catch (error) {
            console.error('Error parsing URL for path matching:', error);
            return null;
        }
    }

    /**
     * Check if we should intercept Incapsula requests
     */
    private shouldInterceptIncapsulaRequest(requestUrl: string, method: string, scriptPath: string): boolean {
        return method === 'POST' && requestUrl.includes(scriptPath);
    }

    /**
     * Extract domain from request URL and get corresponding sitekey
     */
    private getSitekeyForRequest(requestUrl: string, scriptPath: string): string | null {
        try {
            const url = new URL(requestUrl);
            const domainParam = url.searchParams.get('d');

            if (domainParam && this.scriptPathToSitekey.has(scriptPath)) {
                const baseSitekey = this.scriptPathToSitekey.get(scriptPath);
                return baseSitekey || null;
            }

            return null;
        } catch (error) {
            console.error('Error extracting domain from URL:', error);
            return null;
        }
    }

    /**
     * Handle Incapsula request interception
     */
    private async handleIncapsulaRequest(route: Route, page: Page, context: BrowserContext, scriptPath: string, requestUrl: string): Promise<void> {
        let contentType = await route.request().headerValue("content-type");
        if (!contentType.includes("application/json")) {
            // Request is done to get the expiration of the reese84 cookie, let it through.
            console.log(`[IncapsulaHandler] Letting through Reese84 refresh POST request for path: ${scriptPath}`);
            return route.continue();
        }

        console.log(`[IncapsulaHandler] Intercepting Incapsula POST request for path: ${scriptPath}`);

        // Get the sitekey for this request
        const sitekey = this.getSitekeyForRequest(requestUrl, scriptPath);

        if (!sitekey) {
            console.log('[IncapsulaHandler] Could not determine sitekey, continuing with original request');
            return route.continue();
        }

        console.log(`[IncapsulaHandler] Using sitekey: ${sitekey} for request`);

        // Track this interception
        if (!this.scriptCapture.interceptedPaths.includes(scriptPath)) {
            this.scriptCapture.interceptedPaths.push(scriptPath);
        }
        this.scriptCapture.activeSitekeys.set(scriptPath, sitekey);

        // Get current user agent if not set
        if (!this.userAgent) {
            this.userAgent = await page.evaluate(() => navigator.userAgent);
        }

        const result = await generateReese84Sensor(this.session, new Reese84Input(
            this.userAgent,
            sitekey,
            this.ipAddress,
            this.acceptLanguage,
            page.url(),
            "", // TODO: handle POW
            "",
            this.scriptPathToScriptUrl.get(scriptPath) || "", // Use captured script URL
        ));

        console.log(`[IncapsulaHandler] Request details - Sitekey: ${sitekey}, UserAgent: ${this.userAgent}, IP: ${this.ipAddress}`);

        await route.continue({
            postData: result
        });
    }

    /**
     * Add or update script path to sitekey mapping
     */
    public addScriptPathMapping(scriptPath: string, sitekey: string): void {
        this.scriptPathToSitekey.set(scriptPath, sitekey);
        console.log(`[IncapsulaHandler] Added mapping: ${scriptPath} -> ${sitekey}`);
    }

    /**
     * Remove script path mapping
     */
    public removeScriptPathMapping(scriptPath: string): void {
        this.scriptPathToSitekey.delete(scriptPath);
        console.log(`[IncapsulaHandler] Removed mapping for: ${scriptPath}`);
    }

    /**
     * Get current capture status
     */
    public getStatus(): IncapsulaScriptCapture & { scriptPathMappings: Map<string, string>; scriptUrls: Map<string, string> } {
        return {
            ...this.scriptCapture,
            scriptPathMappings: new Map(this.scriptPathToSitekey),
            scriptUrls: new Map(this.scriptPathToScriptUrl)
        };
    }

    /**
     * Reset the handler state
     */
    public reset(): void {
        this.scriptCapture = {
            interceptedPaths: [],
            activeSitekeys: new Map()
        };
        this.scriptPathToScriptUrl.clear();
    }
}