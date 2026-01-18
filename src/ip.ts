export async function fetchIpAddressWithBrowser(page: any, apiKey: string): Promise<string> {
    try {
        const response = await page.request.get('https://ip.hypersolutions.co/ip', {
            headers: {
                'x-api-key': apiKey,
                'Content-Type': 'application/json'
            },
            ignoreHTTPSErrors: true,
        });

        if (!response.ok()) {
            throw new Error(`HTTP error! status: ${response.status()}`);
        }

        const data = await response.json();
        return data.ip;
    } catch (error) {
        console.error('Failed to fetch IP address through browser:', error);
        throw error;
    }
}