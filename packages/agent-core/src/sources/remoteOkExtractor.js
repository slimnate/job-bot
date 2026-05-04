import { withAgentRetry } from '../retry.js';
const sourceName = 'remoteok';
const defaultRemoteOkUrl = 'https://remoteok.com/remote-dev-jobs';
export class RemoteOkDeterministicExtractor {
    source = sourceName;
    url;
    maxPostings;
    constructor(options = {}) {
        this.url = options.url ?? defaultRemoteOkUrl;
        this.maxPostings = options.maxPostings ?? 50;
    }
    async extract(driver) {
        await withAgentRetry(async () => {
            await driver.navigate(this.url, { waitForLoad: true, timeoutMs: 25000 });
            await driver.waitForSelector('table#jobsboard');
        }, {
            maxAttempts: 2,
            baseDelayMs: 500,
            maxDelayMs: 5000,
            label: 'remoteok.extract.navigate',
        });
        const scraped = await driver.evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('table#jobsboard tr.job'));

      return rows
        .map((row) => {
          const id = row.getAttribute('data-id') ?? '';
          const anchor = row.querySelector('a.preventLink') ?? row.querySelector('a');
          const href = anchor?.getAttribute('href') ?? '';
          const titleNode = row.querySelector('h2[itemprop="title"]') ?? row.querySelector('h2');
          const companyNode = row.querySelector('h3[itemprop="name"]') ?? row.querySelector('h3');
          const locationNode = row.querySelector('.location');
          const salaryNode = row.querySelector('.salary');
          const descriptionNode = row.querySelector('.description');

          const normalizedHref = href.startsWith('http')
            ? href
            : href.length > 0
              ? 'https://remoteok.com' + href
              : '';

          const externalId = id || normalizedHref;

          if (!externalId || !normalizedHref || !titleNode || !companyNode) {
            return null;
          }

          return {
            externalId,
            url: normalizedHref,
            title: titleNode.textContent?.trim() ?? '',
            company: companyNode.textContent?.trim() ?? '',
            location: locationNode?.textContent?.trim() || undefined,
            salaryText: salaryNode?.textContent?.trim() || undefined,
            descriptionSnippet: descriptionNode?.textContent?.trim() || undefined,
          };
        })
        .filter((posting) => posting !== null);
    })()`);
        const now = Date.now();
        const postings = scraped
            .map((posting) => ({
            externalId: posting.externalId,
            url: posting.url,
            title: posting.title,
            company: posting.company,
            location: posting.location,
            salaryText: posting.salaryText,
            descriptionSnippet: posting.descriptionSnippet,
            discoveredAt: now,
            rawPayload: {
                extractor: 'remoteok-deterministic',
                source: sourceName,
            },
        }))
            .filter((posting) => posting.externalId.length > 0 && posting.url.length > 0)
            .slice(0, this.maxPostings);
        return {
            source: sourceName,
            postings,
        };
    }
}
//# sourceMappingURL=remoteOkExtractor.js.map