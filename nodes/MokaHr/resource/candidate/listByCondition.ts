import { IDataObject, NodeOperationError } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import { mokaRequest } from '../../../help/utils/MokaRequest';
import {
	batchingOption,
	paginationOptions,
	proxyOption,
	readBatchConfig,
	readRequestOptions,
	timeoutOption,
} from '../../../help/utils/sharedOptions';

/**
 * 根据条件查询申请信息（分页）
 * POST /api-platform/v3/applications/list_by_condition
 * https://www.mokahr.com/docs/api/#-168
 */

const PATH = '/api-platform/v3/applications/list_by_condition';
const MAX_ID_LIST_LENGTH = 20;
/** 接口单页上限。Return All 固定用这个值翻页，Limit 超过它时按 next 继续请求。 */
const MAX_PAGE_SIZE = 20;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface IApplicationPage {
	applicationList?: IDataObject[];
	next?: string | null;
}

interface ITimeRange {
	startKey: string;
	endKey: string;
	label: string;
}

const TIME_RANGES: ITimeRange[] = [
	{ startKey: 'updateAtStartTime', endKey: 'updateAtEndTime', label: '更新时间' },
	{
		startKey: 'applicationCreateStartTime',
		endKey: 'applicationCreateEndTime',
		label: '数据创建时间',
	},
	{
		startKey: 'applicationAppliedAtStartTime',
		endKey: 'applicationAppliedAtEndTime',
		label: '申请创建时间',
	},
];

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

function parsePositiveInt(raw: unknown, label: string): number | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;
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

function parseIntegerList(raw: unknown, label: string, maxLength?: number): number[] {
	const parts = parseStringList(raw);
	if (maxLength !== undefined && parts.length > maxLength) {
		throw new Error(`${label} 最多 ${maxLength} 个，当前 ${parts.length} 个`);
	}
	return parts.map((part) => {
		const value = parsePositiveInt(part, label);
		if (value === undefined) {
			throw new Error(`${label} 包含空值`);
		}
		return value;
	});
}

function parseEnumInt(raw: unknown, allowed: number[], label: string): number | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;
	const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
	if (!allowed.includes(value)) {
		throw new Error(`${label} 只能是 ${allowed.join('、')}`);
	}
	return value;
}

function parseOptionalBoolean(raw: unknown, label: string): boolean | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;
	if (raw === true || raw === 'true') return true;
	if (raw === false || raw === 'false') return false;
	throw new Error(`${label} 只能是 true 或 false`);
}

/**
 * 日期选择器得到 ISO 字符串，表达式也可以直接给毫秒时间戳。
 */
function parseTimestamp(raw: unknown, label: string): number | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;
	if (typeof raw === 'number') {
		if (!Number.isFinite(raw)) {
			throw new Error(`${label} 不是有效时间`);
		}
		return raw;
	}
	const text = String(raw).trim();
	if (!text) return undefined;
	if (/^\d+$/.test(text)) {
		return Number(text);
	}
	const ms = Date.parse(text);
	if (Number.isNaN(ms)) {
		throw new Error(`${label} 不是有效时间`);
	}
	return ms;
}

function addMonthsUtc(timestamp: number, months: number): number {
	const result = new Date(timestamp);
	result.setUTCMonth(result.getUTCMonth() + months);
	return result.getTime();
}

function readNextCursor(next: unknown): string {
	return typeof next === 'string' ? next.trim() : '';
}

function buildFilterBody(filters: IDataObject): IDataObject {
	const body: IDataObject = {};

	const applicationIds = parseIntegerList(
		filters.applicationIds,
		'申请 ID 列表',
		MAX_ID_LIST_LENGTH,
	);
	const candidateIds = parseIntegerList(filters.candidateIds, '候选人 ID 列表', MAX_ID_LIST_LENGTH);
	const pipelineIds = parseIntegerList(filters.pipelineIds, '流程 ID 列表');
	const stageIds = parseIntegerList(filters.stageIds, '阶段 ID 列表');
	const jobId =
		filters.jobId === undefined || filters.jobId === null ? '' : String(filters.jobId).trim();
	const hireMode = parseEnumInt(filters.hireMode, [1, 2], '招聘模式');
	const archived = parseOptionalBoolean(filters.archived, '是否归档');
	const invitationUpdateStatus = parseEnumInt(
		filters.invitationUpdateStatus,
		[0, 1, 2],
		'邀请更新状态',
	);
	const headhunterId = parsePositiveInt(filters.headhunterId, '猎头顾问 ID');
	const headhunterContractId = parsePositiveInt(filters.headhunterContractId, '猎头合同 ID');
	const sourceId = parsePositiveInt(filters.sourceId, '来源 ID');
	const skipTimeWindow =
		headhunterId !== undefined || headhunterContractId !== undefined || sourceId !== undefined;

	if (applicationIds.length > 0) body.applicationIds = applicationIds;
	if (candidateIds.length > 0) body.candidateIds = candidateIds;
	if (pipelineIds.length > 0) body.pipelineIds = pipelineIds;
	if (stageIds.length > 0) body.stageIds = stageIds;
	if (jobId) body.jobId = jobId;
	if (hireMode !== undefined) body.hireMode = hireMode;
	if (archived !== undefined) body.archived = archived;
	if (invitationUpdateStatus !== undefined) body.invitationUpdateStatus = invitationUpdateStatus;
	if (headhunterId !== undefined) body.headhunterId = headhunterId;
	if (headhunterContractId !== undefined) body.headhunterContractId = headhunterContractId;
	if (sourceId !== undefined) body.sourceId = sourceId;

	for (const range of TIME_RANGES) {
		const start = parseTimestamp(filters[range.startKey], `${range.label}开始`);
		const end = parseTimestamp(filters[range.endKey], `${range.label}结束`);
		if (start === undefined && end === undefined) continue;
		if (start === undefined || end === undefined) {
			throw new Error(`${range.label}需要同时填写开始和结束`);
		}
		if (end < start) {
			throw new Error(`${range.label}的结束时间不能早于开始时间`);
		}
		if (!skipTimeWindow && end > addMonthsUtc(start, 3)) {
			throw new Error(
				`${range.label}跨度最大 3 个月。填写猎头顾问 ID、猎头合同 ID 或来源 ID 后可取消该限制`,
			);
		}
		body[range.startKey] = start;
		body[range.endKey] = end;
	}

	return body;
}

const operation: ResourceOperations = {
	name: '根据条件查询申请信息',
	value: 'listByCondition',
	description: '按流程、阶段、时间等条件分页查询申请',
	action: '',
	order: 20,
	options: [
		{
			displayName:
				'筛选条件均可选。申请 ID、候选人 ID 最多各 20 个。未填猎头顾问、猎头合同或来源 ID 时，每组时间跨度最大 3 个月。接口每页最多 20 条。',
			name: 'noticeListByCondition',
			type: 'notice',
			default: '',
		},
		paginationOptions.returnAll,
		paginationOptions.limit(),
		{
			displayName: '筛选条件',
			name: 'filters',
			type: 'collection',
			placeholder: 'Add Filter',
			default: {},
			options: [
				{
					displayName: '申请 ID 列表',
					name: 'applicationIds',
					type: 'string',
					default: '',
					placeholder: '411336681,411336911',
					description: '申请 ID，最多 20 个。可填写逗号或换行拼接的字符串，或用表达式返回数组',
				},
				{
					displayName: '候选人 ID 列表',
					name: 'candidateIds',
					type: 'string',
					default: '',
					placeholder: '201307334',
					description: '候选人 ID，最多 20 个。可填写逗号或换行拼接的字符串，或用表达式返回数组',
				},
				{
					displayName: '职位 ID',
					name: 'jobId',
					type: 'string',
					default: '',
					placeholder: '23661249-be3f-47de-8d81-15fa4f894875',
					description: 'Moka 职位 ID，一般为 UUID',
				},
				{
					displayName: '流程 ID 列表',
					name: 'pipelineIds',
					type: 'string',
					default: '',
					placeholder: '17,87',
					description: '流程 ID。可填写逗号或换行拼接的字符串，或用表达式返回数组',
				},
				{
					displayName: '阶段 ID 列表',
					name: 'stageIds',
					type: 'string',
					default: '',
					placeholder: '56,58',
					description: '阶段 ID。可填写逗号或换行拼接的字符串，或用表达式返回数组',
				},
				{
					displayName: '招聘模式',
					name: 'hireMode',
					type: 'options',
					default: '',
					options: [
						{ name: '不筛选', value: '' },
						{ name: '社招', value: 1 },
						{ name: '校招', value: 2 },
					],
					description: '社招为 1，校招为 2。不选则不传',
				},
				{
					displayName: '是否归档',
					name: 'archived',
					type: 'options',
					default: '',
					options: [
						{ name: '不筛选', value: '' },
						{ name: '已归档', value: 'true' },
						{ name: '未归档', value: 'false' },
					],
					description: '已归档或未归档。不选则不传',
				},
				{
					displayName: '邀请更新状态',
					name: 'invitationUpdateStatus',
					type: 'options',
					default: '',
					options: [
						{ name: '不筛选', value: '' },
						{ name: '未邀请', value: 0 },
						{ name: '未更新', value: 1 },
						{ name: '已更新', value: 2 },
					],
					description: '未邀请为 0，未更新为 1，已更新为 2。不选则不传',
				},
				{
					displayName: '更新开始时间',
					name: 'updateAtStartTime',
					type: 'dateTime',
					default: '',
					description: '更新开始时间。需和结束时间一起填，跨度最大 3 个月',
				},
				{
					displayName: '更新结束时间',
					name: 'updateAtEndTime',
					type: 'dateTime',
					default: '',
					description: '更新结束时间。需和开始时间一起填，跨度最大 3 个月',
				},
				{
					displayName: '数据创建开始时间',
					name: 'applicationCreateStartTime',
					type: 'dateTime',
					default: '',
					description: '申请首次写入数据库的开始时间。需和结束时间一起填，跨度最大 3 个月',
				},
				{
					displayName: '数据创建结束时间',
					name: 'applicationCreateEndTime',
					type: 'dateTime',
					default: '',
					description: '申请首次写入数据库的结束时间。需和开始时间一起填，跨度最大 3 个月',
				},
				{
					displayName: '申请创建开始时间',
					name: 'applicationAppliedAtStartTime',
					type: 'dateTime',
					default: '',
					description: '系统展示的申请日期开始时间。需和结束时间一起填，跨度最大 3 个月',
				},
				{
					displayName: '申请创建结束时间',
					name: 'applicationAppliedAtEndTime',
					type: 'dateTime',
					default: '',
					description: '系统展示的申请日期结束时间。需和开始时间一起填，跨度最大 3 个月',
				},
				{
					displayName: '猎头顾问 ID',
					name: 'headhunterId',
					type: 'string',
					default: '',
					description: '只返回该猎头顾问名下的申请，并取消 3 个月时间窗口限制',
				},
				{
					displayName: '猎头合同 ID',
					name: 'headhunterContractId',
					type: 'string',
					default: '',
					description: '只返回该猎头合同名下的申请，并取消 3 个月时间窗口限制',
				},
				{
					displayName: '来源 ID',
					name: 'sourceId',
					type: 'string',
					default: '',
					description: '只返回该申请来源名下的申请，并取消 3 个月时间窗口限制',
				},
			],
		},
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			options: [timeoutOption(), batchingOption({ showWhen: { '/returnAll': [true] } }), proxyOption],
		},
	],
	call: async function (index) {
		const returnAll = this.getNodeParameter('returnAll', index, false) as boolean;
		const { timeout, proxy } = readRequestOptions.call(this, index);
		const filters = this.getNodeParameter('filters', index, {}) as IDataObject;

		let filterBody: IDataObject;
		try {
			filterBody = buildFilterBody(filters);
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				error instanceof Error ? error.message : String(error),
				{ itemIndex: index },
			);
		}

		const requestPage = async (cursor: string, pageSize: number): Promise<IApplicationPage> => {
			const data = await mokaRequest<IApplicationPage>(this, {
				method: 'POST',
				path: PATH,
				body: cursor ? { next: cursor } : { ...filterBody, limit: pageSize },
				itemIndex: index,
				timeout,
				proxy,
			});
			return data ?? {};
		};

		const readPage = (data: IApplicationPage) => ({
			list: Array.isArray(data.applicationList) ? data.applicationList : [],
			next: readNextCursor(data.next),
		});

		if (returnAll) {
			const batchConfig = readBatchConfig.call(this, index);
			const perRequestDelay = Math.max(
				1,
				Math.ceil(batchConfig.batchInterval / Math.max(1, batchConfig.batchSize)),
			);
			const allRecords: IDataObject[] = [];
			const seen = new Set<string>();
			let cursor = '';
			let pageIndex = 0;

			while (true) {
				if (pageIndex > 0) {
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

				const { list, next } = readPage(await requestPage(cursor, MAX_PAGE_SIZE));
				allRecords.push(...list);
				if (!next || list.length === 0) {
					return allRecords;
				}
				cursor = next;
				pageIndex += 1;
			}
		}

		const limit = Number(this.getNodeParameter('limit', index, 50));
		if (!Number.isInteger(limit) || limit < 1) {
			throw new NodeOperationError(this.getNode(), 'Limit 必须是大于等于 1 的整数', {
				itemIndex: index,
			});
		}

		const collected: IDataObject[] = [];
		const seen = new Set<string>();
		let cursor = '';
		while (collected.length < limit) {
			const pageSize = Math.min(MAX_PAGE_SIZE, limit - collected.length);
			if (cursor) {
				if (seen.has(cursor)) {
					throw new NodeOperationError(this.getNode(), '分页游标重复，已停止翻页', {
						itemIndex: index,
					});
				}
				seen.add(cursor);
			}

			const { list, next } = readPage(await requestPage(cursor, pageSize));
			collected.push(...list);
			if (!next || list.length === 0) {
				break;
			}
			cursor = next;
		}

		return collected.slice(0, limit);
	},
};

export default operation;
