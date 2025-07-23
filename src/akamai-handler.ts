import { Page, BrowserContext } from 'playwright';
import { Session } from 'hyper-sdk-js';
import { generateSensorData, SensorInput } from "hyper-sdk-js/akamai/sensor";
import { generateSbsdPayload, SbsdInput } from "hyper-sdk-js/akamai/sbsd";
import { parseV3DynamicValues, V3DynamicInput } from "hyper-sdk-js/akamai/dynamic";
import {Route} from "@playwright/test";

export interface AkamaiHandlerConfig {
    session: Session;
    ipAddress: string;
    userAgent?: string;
    acceptLanguage?: string;
}

export interface ScriptCapture {
    scriptUrl: string | null;
    dynamicValues: string | null;
    sbsdScriptUrl: string | null;
    sbsdResponseText: string | null;
    sbsdUuid: string | null;
}

export class AkamaiHandler {
    private session: Session;
    private userAgent: string;
    private ipAddress: string;
    private acceptLanguage: string;
    private sessionContext: string = "";
    private sbsdIndex: number = 0;

    // Captured data
    private scriptCapture: ScriptCapture = {
        scriptUrl: null,
        dynamicValues: null,
        sbsdScriptUrl: null,
        sbsdResponseText: null,
        sbsdUuid: null
    };

    // Promise management for dynamic values
    private dynamicValuesPromise: Promise<void>;
    private resolveDynamicValues: (() => void) | null = null;

    constructor(config: AkamaiHandlerConfig) {
        this.session = config.session;
        this.ipAddress = config.ipAddress;
        this.userAgent = config.userAgent || '';
        this.acceptLanguage = config.acceptLanguage || 'en-US,en;q=0.9';

        this.dynamicValuesPromise = new Promise((resolve) => {
            this.resolveDynamicValues = resolve;
        });
    }

    /**
     * Initialize the handler on a Playwright page
     */
    public async initialize(page: Page, context: BrowserContext): Promise<void> {
        await this.setupResponseHandler(page);
        await this.setupRequestInterceptor(page, context);
    }

    /**
     * Set up response handler to capture script URLs and dynamic values
     */
    private async setupResponseHandler(page: Page): Promise<void> {
        page.on('response', async (response) => {
            const request = response.request();
            const headers = response.headers();
            const requestUrl = request.url();

            try {
                // Capture sensor script URL and dynamic values
                if (request.method() === 'GET' && 'time-to-live-seconds' in headers) {
                    await this.handleSensorScriptResponse(response, requestUrl);
                }

                // Capture SBSD script URL
                if (request.method() === 'GET') {
                    await this.handleSbsdScriptResponse(response, requestUrl);
                }
            } catch (error) {
                console.error('Error in response handler:', error);
            }
        });
    }

    /**
     * Handle sensor script response
     */
    private async handleSensorScriptResponse(response: any, requestUrl: string): Promise<void> {
        this.scriptCapture.scriptUrl = requestUrl;
        console.log(`[AkamaiHandler] Captured sensor script URL: ${requestUrl}`);

        // Reset context because we're working with a newly loaded script
        this.sessionContext = "";

        const buffer = await response.body();
        const responseText = buffer.toString('utf-8');
        this.scriptCapture.dynamicValues = await parseV3DynamicValues(
            this.session,
            new V3DynamicInput(responseText)
        );

        if (this.resolveDynamicValues) {
            this.resolveDynamicValues();
        }
        console.log('[AkamaiHandler] Dynamic values parsed and ready');
    }

    /**
     * Handle SBSD script response
     */
    private async handleSbsdScriptResponse(response: any, requestUrl: string): Promise<void> {
        const url = new URL(requestUrl);
        const vParam = url.searchParams.get('v');
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (vParam && uuidRegex.test(vParam)) {
            // Save URL without the v parameter
            url.searchParams.delete('v');
            this.scriptCapture.sbsdScriptUrl = url.toString();
            this.scriptCapture.sbsdUuid = vParam;

            console.log(`[AkamaiHandler] Captured SBSD script URL: ${this.scriptCapture.sbsdScriptUrl}`);

            // Save response text for payload generation
            const buffer = await response.body();
            this.scriptCapture.sbsdResponseText = buffer.toString('utf-8');
            // Reset index because we're working with a new sbsd script
            this.sbsdIndex = 0;
            console.log('[AkamaiHandler] SBSD response text saved');
        }
    }

    /**
     * Set up request interceptor to replace sensor data
     */
    private async setupRequestInterceptor(page: Page, context: BrowserContext): Promise<void> {
        // Regex pattern for sensor scripts like: https://www.example.com/CKo1/13Fb/v_Lq/cYPX7Q/EiOLQt3r3zrVh4t9/aG4BHUZtAQ/Li/gIKUZfMA0B
        const sensorScriptRegex = /^https?:\/\/[^\/]+\/[a-zA-Z\d\/\-_]+$/i;

        await page.route(sensorScriptRegex, async (route) => {
            const request = route.request();
            const requestUrl = request.url();

            try {
                // Handle sensor data replacement
                if (this.shouldInterceptSensorRequest(requestUrl, request.method())) {
                    await this.handleSensorRequest(route, page, context);
                    return;
                }

                // Continue with normal request
                return route.continue();
            } catch (error) {
                console.error('Error in sensor request interceptor:', error);
                return route.continue();
            }
        });

        // Regex pattern for SBSD scripts like: https://www.example.com/path/script.js?v=12345678-1234-1234-1234-123456789012
        const sbsdScriptRegex = /^https?:\/\/[^\/]+\/[a-zA-Z\d\/\-_\.]+\?v=[a-f\d\-]{36}/i;

        await page.route(sbsdScriptRegex, async (route) => {
            const request = route.request();
            const requestUrl = request.url();

            try {
                // Handle SBSD data replacement
                if (this.shouldInterceptSbsdRequest(requestUrl, request.method())) {
                    await this.handleSbsdRequest(route, page, context);
                    return;
                }

                // Continue with normal request
                return route.continue();
            } catch (error) {
                console.error('Error in SBSD request interceptor:', error);
                return route.continue();
            }
        });

        // Regex pattern for pixel endpoints like: /akam/13/pixel_20d83a45
        const pixelEndpointRegex = /\/akam\/\d+\/pixel_[a-f\d]+$/i;

        await page.route(pixelEndpointRegex, async (route) => {
            const request = route.request();
            const requestUrl = request.url();

            try {
                // Handle pixel endpoint requests
                if (request.method() === 'POST') {
                    console.log(`[AkamaiHandler] Blocking pixel endpoint POST request: ${requestUrl}`);
                    // Block the request by returning a successful response
                    await route.fulfill({
                        status: 200,
                        contentType: 'text/html'
                    });
                    return;
                }

                // Continue with normal request for non-POST methods
                return route.continue();
            } catch (error) {
                console.error('Error in pixel endpoint interceptor:', error);
                return route.continue();
            }
        });
    }

    /**
     * Check if we should intercept sensor requests
     */
    private shouldInterceptSensorRequest(requestUrl: string, method: string): boolean {
        return this.scriptCapture.scriptUrl !== null &&
            requestUrl === this.scriptCapture.scriptUrl &&
            method === 'POST';
    }

    /**
     * Check if we should intercept SBSD requests
     */
    private shouldInterceptSbsdRequest(requestUrl: string, method: string): boolean {
        return this.scriptCapture.sbsdScriptUrl !== null &&
            requestUrl === this.scriptCapture.sbsdScriptUrl &&
            method === 'POST';
    }

    /**
     * Handle sensor request interception
     */
    private async handleSensorRequest(route: Route, page: Page, context: BrowserContext): Promise<void> {
        console.log('[AkamaiHandler] Intercepting sensor POST request');

        // Wait for dynamic values to be available
        await this.dynamicValuesPromise;

        const cookies = await context.cookies();
        const abck = cookies.find(c => c.name === '_abck')?.value;
        const bmsz = cookies.find(c => c.name === 'bm_sz')?.value;

        if (!abck || !bmsz || !this.scriptCapture.dynamicValues) {
            console.log('[AkamaiHandler] Missing required cookies or dynamic values, continuing with original request');
            return route.continue();
        }

        console.log('[AkamaiHandler] Generating fresh sensor data');

        // Get current user agent if not set
        if (!this.userAgent) {
            this.userAgent = await page.evaluate(() => navigator.userAgent);
        }

        // Generate fresh sensor data using SDK
        const result = await generateSensorData(this.session, new SensorInput(
            abck,
            bmsz,
            "3",
            page.url(),
            this.userAgent,
            this.ipAddress,
            this.acceptLanguage,
            this.sessionContext,
            undefined,
            this.scriptCapture.dynamicValues
        ));

        this.sessionContext = result.context;

        const modifiedData = JSON.stringify({
            sensor_data: result.payload
        });

        console.log('[AkamaiHandler] Continuing request with SDK-generated sensor data');

        await route.continue({
            postData: modifiedData
        });
    }

    /**
     * Handle SBSD request interception
     */
    private async handleSbsdRequest(route: any, page: Page, context: BrowserContext): Promise<void> {
        console.log('[AkamaiHandler] Intercepting SBSD POST request');

        const cookies = await context.cookies();
        const bmso = cookies.find(c => c.name === "sbsd_o" || c.name === 'bm_so')?.value;

        if (!bmso || !this.scriptCapture.sbsdResponseText || !this.scriptCapture.sbsdUuid) {
            console.log('[AkamaiHandler] Missing required cookie or SBSD data, continuing with original request');
            return route.continue();
        }

        console.log('[AkamaiHandler] Generating SBSD payload');

        // Get current user agent if not set
        if (!this.userAgent) {
            this.userAgent = await page.evaluate(() => navigator.userAgent);
        }

        // Check if the request URL has a 't' parameter
        const requestUrl = new URL(route.request().url());
        const hasTimeParameter = requestUrl.searchParams.has('t');

        // Use sbsdIndex 0 if 't' parameter exists, otherwise use current sbsdIndex
        const indexToUse = hasTimeParameter ? 0 : this.sbsdIndex;

        console.log(`[AkamaiHandler] Using SBSD index: ${indexToUse} (t parameter: ${hasTimeParameter})`);

        // Generate SBSD payload using SDK
        const result = await generateSbsdPayload(this.session, new SbsdInput(
            indexToUse,
            this.scriptCapture.sbsdUuid,
            bmso,
            page.url(),
            this.userAgent,
            this.scriptCapture.sbsdResponseText,
            this.ipAddress,
            this.acceptLanguage
        ));

        this.sbsdIndex++;

        const modifiedData = JSON.stringify({
            body: result
        });

        console.log('[AkamaiHandler] Continuing SBSD request with SDK-generated data');

        await route.continue({
            postData: modifiedData
        });
    }

    /**
     * Get current capture status
     */
    public getStatus(): ScriptCapture & { sessionContext: string; sbsdIndex: number } {
        return {
            ...this.scriptCapture,
            sessionContext: this.sessionContext,
            sbsdIndex: this.sbsdIndex
        };
    }

    /**
     * Reset the handler state
     */
    public reset(): void {
        this.scriptCapture = {
            scriptUrl: null,
            dynamicValues: null,
            sbsdScriptUrl: null,
            sbsdResponseText: null,
            sbsdUuid: null
        };
        this.sessionContext = "";
        this.sbsdIndex = 0;

        this.dynamicValuesPromise = new Promise((resolve) => {
            this.resolveDynamicValues = resolve;
        });
    }
}