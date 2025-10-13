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
}

export interface IncapsulaScriptCapture {
    interceptedPaths: string[];
    detectedScripts: Map<string, string>; // path -> script URL
}

export class IncapsulaHandler {
    private session: Session;
    private userAgent: string;
    private ipAddress: string;
    private acceptLanguage: string;
    private utmvc: string;

    // Captured data
    private scriptCapture: IncapsulaScriptCapture = {
        interceptedPaths: [],
        detectedScripts: new Map()
    };

    // Map to store script URLs and their paths
    private scriptPathToScriptUrl: Map<string, string> = new Map();
    private scriptPathToScriptContent: Map<string, string> = new Map();
    private detectedReese84Paths: Set<string> = new Set();

    constructor(config: IncapsulaHandlerConfig) {
        this.session = config.session;
        this.ipAddress = config.ipAddress;
        this.userAgent = config.userAgent || '';
        this.acceptLanguage = config.acceptLanguage || 'en-US,en;q=0.9';
    }

    /**
     * Initialize the handler on a Playwright page
     */
    public async initialize(page: Page, context: BrowserContext): Promise<void> {
        await this.setupScriptDetector(page, context);
        await this.setupRequestInterceptor(page, context);
    }

    /**
     * Set up script detector to identify Reese84 scripts
     */
    private async setupScriptDetector(page: Page, context: BrowserContext): Promise<void> {
        page.on('response', async (response) => {
            try {
                const url = response.url();
                const method = response.request().method();

                // Only interested in GET requests
                if (method !== 'GET') return;

                // Check headers
                const headers = response.headers();
                const xCdn = headers['x-cdn'];
                const contentType = headers['content-type'];

                if (!xCdn || xCdn.toLowerCase() !== 'imperva') return;

                if (!contentType || !contentType.toLowerCase().includes('javascript')) return;

                // Get response body
                const body = await response.text();

                // Check if response contains 'var reese84'
                if (!body.includes('var reese84')) return;

                // Extract path from URL
                const urlObj = new URL(url);
                const scriptPath = urlObj.pathname;

                console.log(`[IncapsulaHandler] Detected Reese84 script at path: ${scriptPath}`);
                console.log(`[IncapsulaHandler] Script URL: ${url}`);

                // Store the detected script
                this.detectedReese84Paths.add(scriptPath);
                this.scriptPathToScriptUrl.set(scriptPath, url);
                this.scriptPathToScriptContent.set(scriptPath, body);
                this.scriptCapture.detectedScripts.set(scriptPath, url);

            } catch (error) {
                console.error('Error in script detector:', error);
            }
        });
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
        await page.route(/.*\?.*d=.*/, async (route) => {
            const request = route.request();
            const requestUrl = request.url();

            try {
                // Check if this request matches any of our detected Reese84 script paths
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
     * Find which script path (if any) matches the given URL
     */
    private findMatchingScriptPath(requestUrl: string): string | null {
        try {
            const url = new URL(requestUrl);
            const pathname = url.pathname;

            // Check if any of our detected script paths match this URL
            for (const scriptPath of this.detectedReese84Paths) {
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
     * Handle Incapsula request interception
     */
    private async handleIncapsulaRequest(route: Route, page: Page, context: BrowserContext, scriptPath: string, requestUrl: string): Promise<void> {
        const postData = route.request().postData();

        // If request body starts with a quote, let it through (likely a refresh request)
        if (postData && postData.startsWith('"')) {
            console.log(`[IncapsulaHandler] Letting through Reese84 refresh POST request for path: ${scriptPath}`);
            return route.continue();
        }

        console.log(`[IncapsulaHandler] Intercepting Incapsula POST request for path: ${scriptPath}`);

        // Track this interception
        if (!this.scriptCapture.interceptedPaths.includes(scriptPath)) {
            this.scriptCapture.interceptedPaths.push(scriptPath);
        }

        // Get current user agent if not set
        if (!this.userAgent) {
            this.userAgent = await page.evaluate(() => navigator.userAgent);
        }

        const result = await generateReese84Sensor(this.session, new Reese84Input(
            this.userAgent,
            this.ipAddress,
            this.acceptLanguage,
            page.url(),
            "", // TODO: handle POW
            this.scriptPathToScriptContent.get(scriptPath) || "",
            this.scriptPathToScriptUrl.get(scriptPath) || "", // Use captured script URL
        ));

        console.log(`[IncapsulaHandler] Request details - UserAgent: ${this.userAgent}, IP: ${this.ipAddress}, ScriptPath: ${scriptPath}`);

        await route.continue({
            postData: result
        });
    }

    /**
     * Get current capture status
     */
    public getStatus(): IncapsulaScriptCapture & { scriptUrls: Map<string, string> } {
        return {
            ...this.scriptCapture,
            scriptUrls: new Map(this.scriptPathToScriptUrl)
        };
    }

    /**
     * Reset the handler state
     */
    public reset(): void {
        this.scriptCapture = {
            interceptedPaths: [],
            detectedScripts: new Map()
        };
        this.scriptPathToScriptUrl.clear();
        this.scriptPathToScriptContent.clear();
        this.detectedReese84Paths.clear();
    }
}