import { Page, BrowserContext } from 'playwright';
import { Session, generateSliderPayload, SliderInput, generateInterstitialPayload, InterstitialInput, generateTagsPayload, TagsInput } from 'hyper-sdk-js';

export interface DataDomeHandlerConfig {
    session: Session;
    ipAddress: string;
    userAgent?: string;
    acceptLanguage?: string;
}

export interface CaptchaCapture {
    puzzleImageUrl: string | null;
    pieceImageUrl: string | null;
    puzzleImageBase64: string | null;
    pieceImageBase64: string | null;
    captchaPageUrl: string | null;
    deviceCheckLink: string | null;
    interstitialPageUrl: string | null;
    interstitialPageText: string | null;
}

export class DataDomeHandler {
    private session: Session;
    private userAgent: string;
    private ipAddress: string;
    private acceptLanguage: string;

    // Captured data
    private captchaCapture: CaptchaCapture = {
        puzzleImageUrl: null,
        pieceImageUrl: null,
        puzzleImageBase64: null,
        pieceImageBase64: null,
        captchaPageUrl: null,
        deviceCheckLink: null,
        interstitialPageUrl: null,
        interstitialPageText: null
    };

    // Processing state
    private isProcessing: boolean = false;

    // Promise management for images
    private imagesPromise: Promise<void>;
    private resolveImages: (() => void) | null = null;

    constructor(config: DataDomeHandlerConfig) {
        this.session = config.session;
        this.ipAddress = config.ipAddress;
        this.userAgent = config.userAgent || '';
        this.acceptLanguage = config.acceptLanguage || 'en-US,en;q=0.9';

        this.imagesPromise = new Promise((resolve) => {
            this.resolveImages = resolve;
        });
    }

    /**
     * Initialize the handler on a Playwright page
     */
    public async initialize(page: Page, context: BrowserContext): Promise<void> {
        await this.setupResponseHandler(page);
        await this.setupRequestInterception(page);
    }

    /**
     * Set up request interception for POST requests to interstitial and js endpoints
     */
    private async setupRequestInterception(page: Page): Promise<void> {
        // Intercept interstitial endpoint
        await page.route('https://geo.captcha-delivery.com/interstitial/', async (route) => {
            const request = route.request();

            if (request.method() === 'POST') {
                // Get current user agent if not set
                if (!this.userAgent) {
                    this.userAgent = await page.evaluate(() => navigator.userAgent);
                }

                const interstitialResult = await generateInterstitialPayload(this.session, new InterstitialInput(
                    this.userAgent,
                    this.captchaCapture.interstitialPageUrl,
                    this.captchaCapture.interstitialPageText,
                    this.ipAddress,
                    this.acceptLanguage,
                ));

                if (!interstitialResult) {
                    console.error('[DataDomeHandler] Failed to generate interstitial payload');
                    return;
                }

                console.log('[DataDomeHandler] Successfully generated interstitial payload');

                await route.continue({
                    postData: interstitialResult.payload,
                });

                // Override extra headers
                //await page.setExtraHTTPHeaders(interstitialResult.headers);
            } else {
                await route.continue();
            }
        });

        // Intercept /js endpoint for tags requests
        await page.route(/.*\/js\/?$/, async (route) => {
            const request = route.request();

            if (request.method() === 'POST') {
                const postData = request.postData();

                if (postData && postData.includes('ddk')) {
                    // Get current user agent if not set
                    if (!this.userAgent) {
                        this.userAgent = await page.evaluate(() => navigator.userAgent);
                    }

                    // Parse x-www-form-urlencoded data
                    const parsedData = new URLSearchParams(postData);
                    const keyValues: { [key: string]: string } = {};

                    // Extract all key-value pairs
                    for (const [key, value] of parsedData.entries()) {
                        keyValues[key] = value;
                    }

                    const jsType = (keyValues["jsType"] === "ch" || keyValues["jsType"] === "le") ? keyValues["jsType"] : "ch";

                    const tagsResult = await generateTagsPayload(this.session, new TagsInput(
                        this.userAgent,
                        keyValues["ddk"],
                        decodeURIComponent(keyValues["Referer"]),
                        jsType,
                        this.ipAddress,
                        this.acceptLanguage,
                        keyValues["ddv"],
                        keyValues["cid"],
                    ));

                    if (!tagsResult) {
                        console.error('[DataDomeHandler] Failed to generate tags payload');
                        return;
                    }

                    console.log('[DataDomeHandler] Successfully generated tags payload');

                    await route.continue({
                        postData: tagsResult,
                    });
                } else {
                    await route.continue();
                }
            } else {
                await route.continue();
            }
        });
    }

    /**
     * Set up response handler to capture captcha data
     */
    private async setupResponseHandler(page: Page): Promise<void> {
        page.context().on('response', async (response) => {
            const request = response.request();
            const requestUrl = request.url();

            try {
                // Capture puzzle image
                if (this.isPuzzleImageRequest(requestUrl)) {
                    await this.handlePuzzleImageResponse(response, requestUrl);
                    return;
                }

                // Capture piece image
                if (this.isPieceImageRequest(requestUrl)) {
                    await this.handlePieceImageResponse(response, requestUrl);
                    return;
                }

                // Handle captcha page response
                if (this.isCaptchaPageRequest(requestUrl)) {
                    await this.handleCaptchaPageResponse(response, page);
                    return;
                }

                // Handle interstitial page response
                if (this.isInterstitialPageRequest(requestUrl)) {
                    await this.handleInterstitialPageResponse(response, page);
                    return;
                }
            } catch (error) {
                console.error('[DataDomeHandler] Error in response handler:', error);
            }
        });
    }

    /**
     * Check if this is a puzzle image request
     */
    private isPuzzleImageRequest(requestUrl: string): boolean {
        return requestUrl.includes('dd.prod.captcha-delivery.com/image/') && requestUrl.includes('.jpg');
    }

    /**
     * Check if this is a piece image request
     */
    private isPieceImageRequest(requestUrl: string): boolean {
        return requestUrl.includes('dd.prod.captcha-delivery.com/image/') && requestUrl.includes('.frag.png');
    }

    /**
     * Check if this is a captcha page request
     */
    private isCaptchaPageRequest(requestUrl: string): boolean {
        return requestUrl.includes('geo.captcha-delivery.com/captcha/?initialCid=') && requestUrl.includes('?');
    }

    /**
     * Check if this is an interstitial page request
     */
    private isInterstitialPageRequest(requestUrl: string): boolean {
        return requestUrl.includes('geo.captcha-delivery.com/interstitial/?initialCid=') && requestUrl.includes('?');
    }

    /**
     * Handle puzzle image response
     */
    private async handlePuzzleImageResponse(response: any, requestUrl: string): Promise<void> {
        this.captchaCapture.puzzleImageUrl = requestUrl;
        console.log(`[DataDomeHandler] Captured puzzle image URL: ${requestUrl}`);

        if (response.ok()) {
            const buffer = await response.body();
            this.captchaCapture.puzzleImageBase64 = buffer.toString('base64');
            console.log('[DataDomeHandler] Puzzle image saved as base64');

            this.checkIfImagesReady();
        }
    }

    /**
     * Handle piece image response
     */
    private async handlePieceImageResponse(response: any, requestUrl: string): Promise<void> {
        this.captchaCapture.pieceImageUrl = requestUrl;
        console.log(`[DataDomeHandler] Captured piece image URL: ${requestUrl}`);

        if (response.ok()) {
            const buffer = await response.body();
            this.captchaCapture.pieceImageBase64 = buffer.toString('base64');
            console.log('[DataDomeHandler] Piece image saved as base64');

            this.checkIfImagesReady();
        }
    }

    /**
     * Check if both images are ready and resolve promise
     */
    private checkIfImagesReady(): void {
        if (this.captchaCapture.puzzleImageBase64 && this.captchaCapture.pieceImageBase64) {
            if (this.resolveImages) {
                this.resolveImages();
            }
            console.log('[DataDomeHandler] Both images captured and ready');
        }
    }

    /**
     * Handle captcha page response
     */
    private async handleCaptchaPageResponse(response: any, page: Page): Promise<void> {
        if (this.isProcessing) return;

        const responseUrl = response.url();

        // Check for hardblock (t=bv parameter)
        if (responseUrl.includes('t=bv')) {
            console.log('[DataDomeHandler] Hardblock detected (t=bv) - cannot solve this captcha');
            return;
        }

        try {
            this.isProcessing = true;
            this.captchaCapture.captchaPageUrl = responseUrl;
            console.log(`[DataDomeHandler] Captcha page detected: ${responseUrl}`);

            // Get the response text early - we'll need it for both noPuzzle check and slider payload
            const responseText = await response.text();

            // Find the captcha iframe
            const captchaFrame = page.frames().find(frame =>
                frame.url().includes('captcha-delivery.com')
            );

            if (!captchaFrame) {
                console.error('[DataDomeHandler] Could not find captcha iframe');
                return;
            }

            // Wait a moment for the iframe to initialize ddm object
            await page.waitForTimeout(500);

            // Check if noPuzzle mode is enabled (images won't load automatically)
            const noPuzzleMode = await captchaFrame.evaluate(() => {
                const ddm = (window as any).ddm;
                console.log('[DataDomeHandler] ddm object:', ddm);
                console.log('[DataDomeHandler] ddm.noPuzzle:', ddm?.noPuzzle);
                return ddm?.noPuzzle === true;
            });

            console.log(`[DataDomeHandler] noPuzzle mode detected: ${noPuzzleMode}`);

            if (noPuzzleMode) {
                // Parse captchaChallengePath from the response HTML
                const captchaPathMatch = responseText.match(/captchaChallengePath:\s*['"]([^'"]+)['"]/);

                if (captchaPathMatch && captchaPathMatch[1]) {
                    const captchaChallengePath = captchaPathMatch[1];
                    console.log(`[DataDomeHandler] Found captchaChallengePath: ${captchaChallengePath}`);

                    // Derive the fragment image path
                    const lastDotIndex = captchaChallengePath.lastIndexOf('.');
                    const extension = lastDotIndex > -1 ? captchaChallengePath.slice(lastDotIndex) : '';
                    const fragImagePath = captchaChallengePath.replace(extension, '.frag.png');
                    console.log(`[DataDomeHandler] Derived fragment image path: ${fragImagePath}`);

                    // Trigger image loading in the iframe to fire the network requests
                    console.log('[DataDomeHandler] Triggering manual image loading for noPuzzle mode...');
                    await captchaFrame.evaluate(({ puzzlePath, fragPath }) => {
                        console.log('[DataDomeHandler-iframe] Loading puzzle image:', puzzlePath);
                        console.log('[DataDomeHandler-iframe] Loading fragment image:', fragPath);

                        // Load the puzzle image (main background)
                        const puzzleImg = new Image();
                        puzzleImg.crossOrigin = 'Anonymous';
                        puzzleImg.onload = () => console.log('[DataDomeHandler-iframe] Puzzle image loaded successfully');
                        puzzleImg.onerror = (e) => console.error('[DataDomeHandler-iframe] Puzzle image failed to load:', e);
                        puzzleImg.src = puzzlePath;

                        // Load the fragment image (the sliding piece)
                        const fragImg = new Image();
                        fragImg.crossOrigin = 'Anonymous';
                        fragImg.onload = () => console.log('[DataDomeHandler-iframe] Fragment image loaded successfully');
                        fragImg.onerror = (e) => console.error('[DataDomeHandler-iframe] Fragment image failed to load:', e);
                        fragImg.src = fragPath;
                    }, { puzzlePath: captchaChallengePath, fragPath: fragImagePath });

                    console.log('[DataDomeHandler] Manual image loading triggered, waiting for network responses...');
                } else {
                    console.error('[DataDomeHandler] noPuzzle mode detected but could not parse captchaChallengePath from response');
                    console.log('[DataDomeHandler] Response text snippet:', responseText.substring(0, 2000));
                    return;
                }
            } else {
                console.log('[DataDomeHandler] Normal puzzle mode - images should load automatically');
            }

            // Wait for both images to be available
            console.log('[DataDomeHandler] Waiting for images to be captured...');
            await this.imagesPromise;

            // Find the captcha iframe page
            const captchaPage = await this.findCaptchaIframePage(page);
            if (!captchaPage) {
                console.error('[DataDomeHandler] Could not find captcha iframe page');
                return;
            }

            // Get current user agent if not set
            if (!this.userAgent) {
                this.userAgent = await page.evaluate(() => navigator.userAgent);
            }

            let parentUrl = await captchaFrame.evaluate(() =>  (window.location != window.parent.location) ? document.referrer : document.location.href);

            // Generate device check link
            console.log('[DataDomeHandler] Generating device check link...');

            const sliderResult = await generateSliderPayload(this.session, new SliderInput(
                this.userAgent,
                this.captchaCapture.captchaPageUrl,
                responseText,
                this.captchaCapture.puzzleImageBase64,
                this.captchaCapture.pieceImageBase64,
                parentUrl,
                this.ipAddress,
                this.acceptLanguage,
            ));

            if (!sliderResult) {
                console.error('[DataDomeHandler] Failed to generate device check link');
                return;
            }

            console.log('[DataDomeHandler] Headers for request interception:', sliderResult.headers);

            this.captchaCapture.deviceCheckLink = sliderResult.payload;

            // Execute solution in the iframe
            await this.executeSolutionInIframe(page, sliderResult.payload);
            console.log('[DataDomeHandler] Captcha solution executed successfully');

            // Override extra headers
            //await page.setExtraHTTPHeaders(sliderResult.headers);
        } catch (error) {
            console.error('[DataDomeHandler] Error handling captcha page response:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Handle interstitial page response - simplified to just save data
     */
    private async handleInterstitialPageResponse(response: any, page: Page): Promise<void> {
        if (this.isProcessing) return;

        const responseUrl = response.url();

        // Check for hardblock (t=bv parameter)
        if (responseUrl.includes('t=bv')) {
            console.log('[DataDomeHandler] Hardblock detected (t=bv) - cannot solve this interstitial');
            return;
        }

        try {
            this.isProcessing = true;

            // Save the interstitial page URL and response text
            this.captchaCapture.interstitialPageUrl = responseUrl;
            this.captchaCapture.interstitialPageText = await response.text();

            console.log(`[DataDomeHandler] Interstitial page detected: ${responseUrl}`);
            console.log(`[DataDomeHandler] Saved interstitial page text (${this.captchaCapture.interstitialPageText.length} characters)`);
            console.log('[DataDomeHandler] Interstitial data saved - waiting for POST request interception');

        } catch (error) {
            console.error('[DataDomeHandler] Error handling interstitial page response:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Find the iframe page that contains the captcha
     */
    private async findCaptchaIframePage(page: Page): Promise<Page | null> {
        const pages = page.context().pages();

        for (const currentPage of pages) {
            try {
                const url = currentPage.url();
                if (url.includes('captcha-delivery.com')) {
                    return currentPage;
                }

                // Check if this page has an iframe with the captcha
                const frames = currentPage.frames();
                for (const frame of frames) {
                    if (frame.url().includes('captcha-delivery.com')) {
                        return currentPage;
                    }
                }
            } catch (error) {
                // Page might be closed or not accessible
                continue;
            }
        }

        return null;
    }

    /**
     * Execute the solution in the captcha iframe
     */
    private async executeSolutionInIframe(page: Page, deviceCheckLink: string): Promise<void> {
        try {
            // Find the captcha iframe
            const captchaFrame = page.frames().find(frame =>
                frame.url().includes('captcha-delivery.com')
            );

            if (!captchaFrame) {
                throw new Error('Could not find captcha iframe');
            }

            // This is inspired from window.captchaCallback function that dd uses to communicate with the c.js script
            // which is responsible for redirecting back to the site after solving slider.
            await captchaFrame.evaluate((generatedDeviceCheckLink) => {
                // Extract cid and referer from the device check link
                const url = new URL(generatedDeviceCheckLink);
                const refererParam = url.searchParams.get('referer');

                var request = new XMLHttpRequest();
                request.open('GET', generatedDeviceCheckLink, true);
                request.setRequestHeader("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");

                request.onload = function() {
                    if (this.status >= 200 && this.status < 400) {
                        // Track captcha passed
                        var element = document.getElementById('analyticsCaptchaPassed');
                        if (element) {
                            element.setAttribute('data-analytics-captcha-passed', 'true');
                        }

                        var reloadHref = refererParam;

                        if (window.parent && window.parent.postMessage && this.responseText !== undefined) {
                            var json = JSON.parse(this.responseText);
                            if (json.hasOwnProperty('cookie') && json.cookie !== null) {
                                var origin = '*';
                                // we can't use `window.parent.location.origin` here because access from another origin to `window.parent.location` raises a DOMException
                                // except write a new location but it isn't our case.
                                // get it from refrerer by hand
                                if (document.referrer) {
                                    var pathArray = document.referrer.split('/');
                                    // `pathArray[1]` should be empty string if referer contains protocol. use it!
                                    if (pathArray.length >= 3 && pathArray[1] === '') {
                                        origin = pathArray[0] + '//' + pathArray[2];
                                    } else {
                                        origin = '*';
                                    }

                                    if(origin === document.location.origin) {
                                        // In case of XHR's blocked request, after the retry, the origin is lost, we must send
                                        // the message globally.
                                        origin = '*';
                                    }
                                }

                                window.parent.postMessage(JSON.stringify({'cookie': json.cookie, 'url': reloadHref, 'eventType':'passed', 'responseType': 'captcha'}), origin);
                            }
                        } else {
                            // Fallback reload if postMessage does not exists
                            setTimeout(function () {
                                window.top.location.href = reloadHref;
                            }, 7000);
                        }
                    } else {
                        setTimeout(function () {
                            // Reload compatible with IE 11
                            // @ts-ignore
                            window.location = window.location;
                        }, 2000);
                    }
                };
                request.send();
            }, deviceCheckLink);

        } catch (error) {
            console.error('[DataDomeHandler] Error executing solution in iframe:', error);
        }
    }

    /**
     * Get current capture status
     */
    public getStatus(): CaptchaCapture & { isProcessing: boolean } {
        return {
            ...this.captchaCapture,
            isProcessing: this.isProcessing,
        };
    }

    /**
     * Reset the handler state
     */
    public reset(): void {
        this.captchaCapture = {
            puzzleImageUrl: null,
            pieceImageUrl: null,
            puzzleImageBase64: null,
            pieceImageBase64: null,
            captchaPageUrl: null,
            deviceCheckLink: null,
            interstitialPageUrl: null,
            interstitialPageText: null
        };
        this.isProcessing = false;

        this.imagesPromise = new Promise((resolve) => {
            this.resolveImages = resolve;
        });
    }
}