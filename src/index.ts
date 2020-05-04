import {IncomingMessage, ServerResponse} from "http";
import * as path from 'path';
import * as types from './types';
import urljoin from 'url-join';

export * from './types';

export default class IlcSdk {
    private log: Console;
    private defaultPublicPath: string;

    constructor({logger = console, publicPath = '/'}) {
        this.log = logger;
        this.defaultPublicPath = publicPath;
    }

    public processRequest(req: IncomingMessage): types.RequestData {
        const url = this.parseUrl(req);
        const requestedUrls = this.getRequestUrls(url);
        const passedProps = this.getPassedProps(url);

        return {
            getCurrentReqUrl: () => requestedUrls.requestUrl,
            getCurrentBasePath: () => requestedUrls.basePageUrl,
            getCurrentPathProps: () => passedProps,
        };
    };

    public processResponse(reqData: types.RequestData, res: ServerResponse, data: types.ResponseData): void {
        if (data.pageTitle) {
            res.setHeader('x-head-title', new Buffer(`<title>${data.pageTitle}</title>`).toString('base64'))
        }
        if (data.pageMetaTags) {
            res.setHeader('x-head-meta', new Buffer(data.pageMetaTags).toString('base64'))
        }
        if (data.appAssets) {
            const publicPath = (reqData.getCurrentPathProps() as any).publicPath;
            res.setHeader('Link', this.getLinkHeader(data.appAssets, publicPath));
        }
    }

    private getRequestUrls(url: URL) {
        const res = {
            // Base path used for links on the page, should be relative. Can be ignored if memory routing is in use
            // More info: https://collab.namecheap.net/x/myZdCw
            // https://github.com/ReactTraining/history/blob/3f69f9e07b0a739419704cffc3b3563133281548/docs/Misc.md#using-a-base-url
            basePageUrl: '/',
            requestUrl: '/', // basePageUrl should be deducted from it
        };

        if (url.searchParams.has('routerProps')) {
            const routerProps = JSON.parse(Buffer.from(url.searchParams.get('routerProps')!, 'base64').toString('utf-8'));

            res.basePageUrl = routerProps.basePath;
            res.requestUrl = '/' + path.relative(routerProps.basePath, routerProps.reqUrl);
        } else {
            this.log.warn(`Missing "routerProps" for "${url.href}" request. Fallback to / & /`);
        }

        return res;
    };

    private getPassedProps(url: URL) {
        if (!url.searchParams.has('appProps')) {
            return {};
        }

        try {
            return JSON.parse(Buffer.from(url.searchParams.get('appProps')!, 'base64').toString('utf-8'))
        } catch (e) {
            this.log.warn(`Error while parsing passed props. Falling back to empty object...`, e);

            return {};
        }
    };

    private parseUrl(req: IncomingMessage) {
        return new URL(req.url!, `http://${req.headers.host}`);
    }

    private getLinkHeader (appAssets: types.AppAssets, publicPath?: string) {
        const links = [];

        if (appAssets.cssBundle) {
            links.push(`<${this.buildLink(appAssets.cssBundle, publicPath)}>; rel="stylesheet"`);
        }
        if (appAssets.spaBundle) {
            links.push(`<${this.buildLink(appAssets.spaBundle, publicPath)}>; rel="fragment-script"; as="script"; crossorigin="anonymous"`);
        }

        for (let k in appAssets.dependencies) {
            if (!appAssets.dependencies.hasOwnProperty(k)) {
                continue;
            }

            links.push(`<${this.buildLink(appAssets.dependencies[k], publicPath)}>; rel="fragment-dependency"; name="${k}"`);
        }

        return links.join(',');
    };

    private buildLink(path: string, publicPath?: string) {
        if (path.includes('http://') || path.includes('https://')) {
            return path;
        }

        const pp = publicPath ? publicPath : this.defaultPublicPath;

        return urljoin(pp, path);
    }
}