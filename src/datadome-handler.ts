import { Page, BrowserContext } from 'playwright';
import { Session } from 'hyper-sdk-js';
import { generateSliderPayload, SliderInput } from "hyper-sdk-js/datadome/slider";

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
        deviceCheckLink: null
    };

    // Processing state
    private isProcessing: boolean = false;

    // Promise management for images
    private imagesPromise: Promise<void>;
    private resolveImages: (() => void) | null = null;

    // Headers storage for request interception
    private isHeaderInterceptionEnabled: boolean = false;

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

        try {
            this.isProcessing = true;
            this.captchaCapture.captchaPageUrl = response.url();
            console.log(`[DataDomeHandler] Captcha page detected: ${response.url()}`);

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

            // Generate device check link
            console.log('[DataDomeHandler] Generating device check link...');

            const sliderResult = await generateSliderPayload(this.session, new SliderInput(
                this.userAgent,
                this.captchaCapture.captchaPageUrl,
                await response.text(),
                this.captchaCapture.puzzleImageBase64,
                this.captchaCapture.pieceImageBase64,
                "https://tickets.manutd.com/", // TODO: proper parent url input
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
            await this.executeSolutionInIframe(captchaPage, sliderResult.payload);
            console.log('[DataDomeHandler] Captcha solution executed successfully');

            // Override extra headers
            await page.setExtraHTTPHeaders(sliderResult.headers);
        } catch (error) {
            console.error('[DataDomeHandler] Error handling captcha page response:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Disable header interception
     */
    public disableHeaderInterception(): void {
        this.isHeaderInterceptionEnabled = false;
        console.log('[DataDomeHandler] Header interception disabled');
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

            // Override the captchaCallback function to use our generated device check link
            await captchaFrame.evaluate((generatedDeviceCheckLink) => {
                window.captchaCallback = function() {
                    var cid = ddm.cid;
                    var hash = ddm.hash;

                    if (window.ga && ga.create) {
                        ga('send', 'event', 'Challenge', 'Access to website', 'JSKey: ' + hash + ' - ClientId: ' + cid);
                    }

                    var re = new RegExp("datadome=([^;]+)");
                    var value = re.exec(document.cookie);
                    var ccid = (value != null) ? unescape(value[1]) : null;

                    var parentFrameUrl = (window.location != window.parent.location) ? document.referrer : document.location.href;

                    // ONLY MODIFICATION: Use our generated device check link instead of building captcha check URL
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

                            var cookie = cid;
                            var reloadHref = ddm.referer;

                            if (window.parent && window.parent.postMessage && this.responseText !== undefined) {
                                var json = JSON.parse(this.responseText);
                                if (json.hasOwnProperty('cookie') && json.cookie !== null) {
                                    cookie = json.cookie;
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

                            // to prevent race condition with postMessage that should setup a cookie
                            // adds some sleep for refresh logic
                            setTimeout(function () {
                                if (window.android
                                    && window.android.onCaptchaSuccess) {
                                    window.android.onCaptchaSuccess(cookie);
                                    return;
                                }
                                if (window.webkit
                                    && window.webkit.messageHandlers
                                    && window.webkit.messageHandlers.onCaptchaSuccess
                                    && window.webkit.messageHandlers.onCaptchaSuccess.postMessage) {
                                    window.webkit.messageHandlers.onCaptchaSuccess.postMessage(cookie);
                                    return;
                                }
                                if (ddm.sdkMsgFormat === 'json') {
                                    var message = JSON.stringify({'name': 'onChallengeSolved', 'body': {'cookie': cookie}});
                                    if (window.FlutterWebView && window.FlutterWebView.postMessage) {
                                        window.FlutterWebView.postMessage(message);
                                    } else if (window.ReactNativeWebView && ReactNativeWebView.postMessage) {
                                        window.ReactNativeWebView.postMessage(message);
                                    } else if (window.webkit
                                        && window.webkit.messageHandlers
                                        && window.webkit.messageHandlers.ReactNativeWebView
                                        && window.webkit.messageHandlers.ReactNativeWebView.postMessage) {
                                        window.webkit.messageHandlers.ReactNativeWebView.postMessage(message)
                                    }
                                } else if (window.ReactNativeWebView
                                    && window.ReactNativeWebView.postMessage) {
                                    window.ReactNativeWebView.postMessage(cookie);
                                } else if (window.webkit
                                    && window.webkit.messageHandlers
                                    && window.webkit.messageHandlers.ReactNativeWebView
                                    && window.webkit.messageHandlers.ReactNativeWebView.postMessage) {
                                    window.webkit.messageHandlers.ReactNativeWebView.postMessage(cookie)
                                }
                            }, 500);
                        } else {
                            setTimeout(function () {
                                // Reload compatible with IE 11
                                window.location = window.location;
                            }, 2000);
                        }
                    };
                    request.send();
                };

                // Call the overridden function
                window.captchaCallback();

            }, deviceCheckLink);

        } catch (error) {
            console.error('[DataDomeHandler] Error executing solution in iframe:', error);
        }
    }

    /**
     * Get current capture status
     */
    public getStatus(): CaptchaCapture & { isProcessing: boolean; isHeaderInterceptionEnabled: boolean } {
        return {
            ...this.captchaCapture,
            isProcessing: this.isProcessing,
            isHeaderInterceptionEnabled: this.isHeaderInterceptionEnabled,
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
            deviceCheckLink: null
        };
        this.isProcessing = false;
        this.isHeaderInterceptionEnabled = false;

        this.imagesPromise = new Promise((resolve) => {
            this.resolveImages = resolve;
        });
    }
}