import {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	JsonObject,
	NodeApiError,
	NodeOperationError,
} from 'n8n-workflow';
import { Credentials, MokaSuccessCodes, MokahrRegion, RegionBaseUrls } from '../type/enums';

/**
 * Moka ATS API 标准响应。
 */
export interface IMokaResponse<T = unknown> {
	code: number;
	msg?: string;
	data: T;
}

/**
 * HTTP 2xx 但业务 `code` 不在成功码内。
 * 仅在 `mokaRequest` 内部短暂存在，catch 后转换为 `NodeApiError`。
 */
export class MokaApiError extends Error {
	constructor(
		public readonly code: number,
		public readonly msg: string,
		public readonly raw: IMokaResponse<unknown>,
	) {
		super(`Moka API ${code}: ${msg || '<empty msg>'}`);
		this.name = 'MokaApiError';
	}
}

export interface IMokaRequestOptions {
	method?: IHttpRequestMethods;
	/** 业务接口路径，例如 '/api-platform/v3/applications/list_by_contact_or_id' */
	path: string;
	timeout?: number;
	itemIndex?: number;
	/** 业务成功 code 列表，默认 [200] */
	successCodes?: ReadonlyArray<number>;
	/** true 时返回完整响应（含 code / msg），默认只返回 data */
	returnFullResponse?: boolean;
	body?: IDataObject;
}

function resolveBaseUrl(region: string): string {
	if (region !== 'china' && region !== 'international') {
		throw new Error(`未知系统版本「${region}」，请在凭证中选择中国版或国际版`);
	}
	const baseUrl = RegionBaseUrls[region as MokahrRegion];
	if (!baseUrl.startsWith('https://')) {
		throw new Error('Moka API 必须通过 HTTPS 访问');
	}
	return baseUrl;
}

/**
 * Moka 密钥配置页给出的 value 已是 `Basic <base64>`，原样作为 Authorization。
 * 只复制了 base64 段时补上 Basic 前缀，不再编码。
 */
function buildAuthorization(apiKey: string): string {
	const value = apiKey.trim().replace(/^['"]|['"]$/g, '');
	const token = value.replace(/^basic\s+/i, '').trim();
	return `Basic ${token}`;
}

/**
 * 解析 Moka 标准响应：code 不在 successCodes 内则抛 MokaApiError，默认只返回 data。
 */
export function parseMokaResponse<T = unknown>(
	res: unknown,
	options: {
		successCodes?: ReadonlyArray<number>;
		returnFullResponse?: boolean;
	} = {},
): T {
	if (
		res &&
		typeof res === 'object' &&
		typeof (res as IMokaResponse).code === 'number'
	) {
		const obj = res as IMokaResponse<T>;
		const successCodes = options.successCodes ?? MokaSuccessCodes;
		if (!successCodes.includes(obj.code)) {
			throw new MokaApiError(obj.code, obj.msg ?? '', obj as IMokaResponse<unknown>);
		}
		return (options.returnFullResponse ? obj : (obj.data as T)) as T;
	}

	return res as T;
}

/**
 * Moka ATS API 请求：
 * - 按凭证中的系统版本选择中国版或国际版域名；
 * - Authorization 使用凭证中的密钥配置值（已是 Basic <base64>），不再编码；
 * - 业务 code 非 200 时抛出带原始响应体的 NodeApiError。
 */
export async function mokaRequest<T = IDataObject>(
	ctx: IExecuteFunctions,
	options: IMokaRequestOptions,
): Promise<T> {
	const itemIndex = options.itemIndex;
	const node = ctx.getNode();

	const credentials = await ctx.getCredentials(Credentials.MokaHrApi);
	const region = ((credentials.region as string) ?? '').trim();
	const apiKey = ((credentials.apiKey as string) ?? '').trim();

	if (!apiKey) {
		throw new NodeOperationError(node, '缺少 Authorization：请在凭证中粘贴密钥配置里的 value', {
			itemIndex,
		});
	}

	let baseUrl: string;
	try {
		baseUrl = resolveBaseUrl(region);
	} catch (error) {
		throw new NodeOperationError(node, error instanceof Error ? error.message : String(error), {
			itemIndex,
		});
	}

	const path = options.path.startsWith('/') ? options.path : `/${options.path}`;
	const url = `${baseUrl}${path}`;
	if (!url.startsWith('https://')) {
		throw new NodeOperationError(node, 'Moka API 必须通过 HTTPS 访问', { itemIndex });
	}

	const headers: IDataObject = {
		Authorization: buildAuthorization(apiKey),
		'Content-Type': 'application/json',
	};

	const requestOptions: IHttpRequestOptions = {
		method: options.method ?? 'POST',
		url,
		headers,
		body: options.body,
		json: true,
	};

	if (options.timeout && options.timeout > 0) {
		requestOptions.timeout = options.timeout;
	}

	ctx.logger?.debug?.(`[mokaRequest] ${requestOptions.method} ${path}`, {
		region,
		timeout: requestOptions.timeout,
	});

	try {
		const responseBody = await ctx.helpers.httpRequest(requestOptions);
		return parseMokaResponse<T>(responseBody, {
			successCodes: options.successCodes,
			returnFullResponse: options.returnFullResponse,
		});
	} catch (error) {
		if (error instanceof NodeApiError || error instanceof NodeOperationError) {
			throw error;
		}

		if (error instanceof MokaApiError) {
			throw new NodeApiError(node, error.raw as unknown as JsonObject, {
				message: `Moka API 业务错误：${error.code} ${error.msg || ''}`.trim(),
				description: `path=${path}`,
				itemIndex,
			});
		}

		const errObj = error as {
			response?: { body?: unknown; statusCode?: number };
			message?: string;
		};
		const errorResponse = (errObj.response?.body ?? error ?? {}) as JsonObject;
		throw new NodeApiError(node, errorResponse, {
			message: errObj.message ?? String(error),
			description: `path=${path}`,
			itemIndex,
		});
	}
}

export default mokaRequest;
