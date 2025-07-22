export async function fetchIpAddressWithBrowser(page: any, apiKey: string): Promise<string> {
    try {
        const response = await page.evaluate(async (apiKey: string) => {
            const response = await fetch('https://ip.hypersolutions.co/ip', {
                method: 'GET',
                headers: {
                    'x-api-key': apiKey,
                    'Content-Type': 'application/json'
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        }, apiKey);

        return response.ip;
    } catch (error) {
        console.error('Failed to fetch IP address through browser:', error);
        throw error;
    }
}