import { IDataObject, NodeApiError, NodeOperationError } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import { mokaRequest } from '../../../help/utils/MokaRequest';
import {
	batchingOption,
	paginationOptions,
	readBatchConfig,
	timeoutOption,
} from '../../../help/utils/sharedOptions';

/**
 * 查询人才库下候选人
 * GET /api-platform/v1/talentPool/candidates
 * https://www.mokahr.com/docs/api/
 *
 * 归档时间必填，示例是 YYYY-MM-DD。每页固定 20 条，下一页用响应里的 nextCursor。
 * 示例响应没有业务 code，用 success 表示是否成功。候选人在 data.candidates。
 */

const PATH = '/api-platform/v1/talentPool/candidates';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface ICandidatePage {
	candidates?: IDataObject[];
	Candidates?: IDataObject[];
	nextCursor?: string | null;
}

interface ICandidatesResponse {
	success?: boolean;
	code?: number;
	msg?: string;
	message?: string;
	data?: ICandidatePage;
}

interface ICandidateQuery {
	archivedAtStart: string;
	archivedAtEnd: string;
	talentPoolIds: number[];
	nextCursor?: string;
}

/**
 * 解析字符串列表。
 * 固定值可以是逗号、换行分隔的字符串；表达式可以直接返回字符串数组。
 */
function parseStringList(raw: unknown): string[] {
	if (raw === undefined || raw === null || raw === '') return [];
	if (Array.isArray(raw)) {
		return raw.flatMap((item) => parseStringList(item));
	}
	if (typeof raw !== 'string') {
		const text = String(raw).trim();
		return text ? [text] : [];
	}

	const trimmed = raw.trim();
	if (!trimmed) return [];

	if (trimmed.startsWith('[')) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (Array.isArray(parsed)) {
				return parsed.flatMap((item) => parseStringList(item));
			}
		} catch {
			// 回退到分隔符拆分
		}
	}

	return trimmed
		.split(/[，,\s\n]+/)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function parsePositiveInt(raw: unknown, label: string): number {
	const text = String(raw).trim();
	if (!/^[1-9]\d*$/.test(text)) {
		throw new Error(`${label} 必须是正整数`);
	}
	const value = Number(text);
	if (!Number.isSafeInteger(value)) {
		throw new Error(`${label} 超出安全整数范围`);
	}
	return value;
}

function parseIntegerList(raw: unknown, label: string): number[] {
	return parseStringList(raw).map((part) => parsePositiveInt(part, label));
}

function formatCalendarDate(date: Date, label: string): string {
	if (Number.isNaN(date.getTime())) {
		throw new Error(`${label}不是有效日期`);
	}
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/**
 * 日期选择器得到 ISO 字符串，按本机日历日转成 YYYY-MM-DD。
 * 已经是日期的字符串原样使用。
 */
function formatArchiveDate(raw: unknown, label: string): string {
	if (raw === undefined || raw === null || raw === '') {
		throw new Error(`${label}不能为空`);
	}
	if (typeof raw === 'number') {
		if (!Number.isFinite(raw)) throw new Error(`${label}不是有效日期`);
		return formatCalendarDate(new Date(raw), label);
	}

	const text = String(raw).trim();
	if (!text) throw new Error(`${label}不能为空`);
	if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
	if (/^\d+$/.test(text)) return formatCalendarDate(new Date(Number(text)), label);

	const parsed = Date.parse(text);
	if (Number.isNaN(parsed)) throw new Error(`${label}不是有效日期`);
	return formatCalendarDate(new Date(parsed), label);
}

function buildQuery(
	archivedAtStart: unknown,
	archivedAtEnd: unknown,
	talentPoolIdsRaw: unknown,
	nextCursorRaw: unknown,
): ICandidateQuery {
	const archivedStart = formatArchiveDate(archivedAtStart, '归档开始时间');
	const archivedEnd = formatArchiveDate(archivedAtEnd, '归档结束时间');
	if (archivedEnd < archivedStart) {
		throw new Error('归档结束时间不能早于开始时间');
	}

	const nextCursor =
		nextCursorRaw === undefined || nextCursorRaw === null ? '' : String(nextCursorRaw).trim();

	return {
		archivedAtStart: archivedStart,
		archivedAtEnd: archivedEnd,
		talentPoolIds: parseIntegerList(talentPoolIdsRaw, '人才库 ID'),
		nextCursor: nextCursor || undefined,
	};
}

function buildPath(query: ICandidateQuery, cursor: string): string {
	const params = new URLSearchParams();
	params.set('archivedAtStart', query.archivedAtStart);
	params.set('archivedAtEnd', query.archivedAtEnd);
	if (query.talentPoolIds.length > 0) {
		params.set('talentPoolIds', `[${query.talentPoolIds.join(',')}]`);
	}
	if (cursor) params.set('nextCursor', cursor);
	return `${PATH}?${params.toString()}`;
}

function readCandidatePage(response: unknown): { list: IDataObject[]; nextCursor: string } {
	if (!response || typeof response !== 'object' || Array.isArray(response)) {
		return { list: [], nextCursor: '' };
	}

	const body = response as ICandidatesResponse;
	if (body.success === false) {
		throw new Error(body.msg || body.message || '查询人才库下候选人失败');
	}

	const page =
		body.data && typeof body.data === 'object' ? body.data : (body as unknown as ICandidatePage);
	const list = Array.isArray(page.candidates)
		? page.candidates
		: Array.isArray(page.Candidates)
			? page.Candidates
			: [];
	const nextCursor = typeof page.nextCursor === 'string' ? page.nextCursor.trim() : '';
	return { list, nextCursor };
}

const operation: ResourceOperations = {
	name: '查询人才库下候选人',
	value: 'listCandidates',
	description: '按归档时间分页查询人才库中的候选人',
	action: '',
	order: 20,
	options: [
		{
			displayName:
				'归档开始、结束时间必填，会转成 YYYY-MM-DD。人才库 ID 可选，不填则不按库过滤。接口每页固定 20 条，按 nextCursor 翻页。',
			name: 'noticeListTalentPoolCandidates',
			type: 'notice',
			default: '',
		},
		paginationOptions.returnAll,
		paginationOptions.limit(),
		{
			displayName: '归档开始时间',
			name: 'archivedAtStart',
			type: 'dateTime',
			required: true,
			default: '',
			description: '归档时间下限。请求里转成 YYYY-MM-DD',
		},
		{
			displayName: '归档结束时间',
			name: 'archivedAtEnd',
			type: 'dateTime',
			required: true,
			default: '',
			description: '归档时间上限。请求里转成 YYYY-MM-DD',
		},
		{
			displayName: '人才库 ID 列表',
			name: 'talentPoolIds',
			type: 'string',
			default: '',
			placeholder: '666,888',
			description: '人才库 ID。留空则不按库过滤。可填写逗号或换行拼接的字符串，或用表达式返回数组',
		},
		{
			displayName: '起始游标',
			name: 'nextCursor',
			type: 'string',
			default: '',
			description: '从某一页接着查。留空则从第一页开始，后续翻页使用响应里的 nextCursor',
		},
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			options: [timeoutOption(), batchingOption({ showWhen: { '/returnAll': [true] } })],
		},
	],
	call: async function (index) {
		const returnAll = this.getNodeParameter('returnAll', index, false) as boolean;
		const optionsParam = this.getNodeParameter('options', index, {}) as { timeout?: number };
		const timeout = Number(optionsParam.timeout ?? 0) > 0 ? Number(optionsParam.timeout) : 0;

		let query: ICandidateQuery;
		try {
			query = buildQuery(
				this.getNodeParameter('archivedAtStart', index),
				this.getNodeParameter('archivedAtEnd', index),
				this.getNodeParameter('talentPoolIds', index, ''),
				this.getNodeParameter('nextCursor', index, ''),
			);
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				error instanceof Error ? error.message : String(error),
				{ itemIndex: index },
			);
		}

		const requestPage = async (
			cursor: string,
		): Promise<{ list: IDataObject[]; nextCursor: string }> => {
			const response = await mokaRequest<ICandidatesResponse>(this, {
				method: 'GET',
				path: buildPath(query, cursor),
				itemIndex: index,
				timeout,
				returnFullResponse: true,
				successCodes: [0, 200],
			});
			try {
				return readCandidatePage(response);
			} catch (error) {
				if (error instanceof NodeApiError || error instanceof NodeOperationError) {
					throw error;
				}
				throw new NodeOperationError(
					this.getNode(),
					error instanceof Error ? error.message : String(error),
					{ itemIndex: index },
				);
			}
		};

		let limit = Number.POSITIVE_INFINITY;
		if (!returnAll) {
			limit = Number(this.getNodeParameter('limit', index, 50));
			if (!Number.isInteger(limit) || limit < 1) {
				throw new NodeOperationError(this.getNode(), 'Limit 必须是大于等于 1 的整数', {
					itemIndex: index,
				});
			}
		}

		const batchConfig = returnAll ? readBatchConfig.call(this, index) : undefined;
		const perRequestDelay = batchConfig
			? Math.max(1, Math.ceil(batchConfig.batchInterval / Math.max(1, batchConfig.batchSize)))
			: 0;

		const collected: IDataObject[] = [];
		const seen = new Set<string>();
		let cursor = query.nextCursor ?? '';
		let pageIndex = 0;

		while (collected.length < limit) {
			if (pageIndex > 0 && perRequestDelay > 0) {
				await sleep(perRequestDelay);
			}
			if (cursor) {
				if (seen.has(cursor)) {
					throw new NodeOperationError(this.getNode(), '分页游标重复，已停止翻页', {
						itemIndex: index,
					});
				}
				seen.add(cursor);
			}

			const page = await requestPage(cursor);
			pageIndex += 1;
			collected.push(...page.list);
			if (!page.nextCursor || page.list.length === 0) break;
			cursor = page.nextCursor;
		}

		return collected.slice(0, limit);
	},
};

export default operation;
