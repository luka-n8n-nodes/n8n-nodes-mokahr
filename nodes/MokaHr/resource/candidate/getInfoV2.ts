import { IDataObject, NodeOperationError } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import { mokaRequest } from '../../../help/utils/MokaRequest';
import {
	batchingOption,
	paginationOptions,
	readBatchConfig,
	timeoutOption,
} from '../../../help/utils/sharedOptions';

/**
 * 获取候选人信息 v2（不迭代）
 * POST /api-platform/v2/data/ehrApplications
 * https://www.mokahr.com/docs/api/view/v2.html#v2
 *
 * data 是申请数组，next 在响应顶层。翻页时文档要求只传 next。
 * 更新时间要北京时间，格式 YYYY-MM-DDTHH:mm:ss.sssZ（Z 只是格式，钟点是北京时间）。
 */

const PATH = '/api-platform/v2/data/ehrApplications';
/** 接口单页上限。Return All 固定用这个值翻页，Limit 超过它时按 next 继续请求。 */
const MAX_PAGE_SIZE = 20;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface IEhrPage {
	data?: unknown;
	next?: unknown;
}

interface ITimeRange {
	startKey: string;
	endKey: string;
	label: string;
	/** true：转成北京时间字符串；false：传毫秒时间戳 */
	asBeijingString: boolean;
}

const TIME_RANGES: ITimeRange[] = [
	{
		startKey: 'updateAtStartTime',
		endKey: 'updateAtEndTime',
		label: '更新时间',
		asBeijingString: true,
	},
	{
		startKey: 'applicationCreateStartTime',
		endKey: 'applicationCreateEndTime',
		label: '数据创建时间',
		asBeijingString: false,
	},
	{
		startKey: 'applicationAppliedAtStartTime',
		endKey: 'applicationAppliedAtEndTime',
		label: '申请创建时间',
		asBeijingString: false,
	},
];

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

function parseIntegerList(raw: unknown, label: string): number[] {
	return parseStringList(raw).map((part) => {
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

function parseOptionalString(raw: unknown): string | undefined {
	if (raw === undefined || raw === null) return undefined;
	const text = String(raw).trim();
	return text ? text : undefined;
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

/** 把时间点格式化成北京时间钟点，并套上文档要求的 Z 后缀。 */
function formatBeijingIso(timestamp: number): string {
	const shifted = new Date(timestamp + BEIJING_OFFSET_MS);
	const pad = (value: number, width = 2) => String(value).padStart(width, '0');
	return (
		`${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
		`T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
		`.${pad(shifted.getUTCMilliseconds(), 3)}Z`
	);
}

function readNextCursor(next: unknown): string {
	if (typeof next === 'string') return next.trim();
	if (typeof next === 'number' && Number.isFinite(next)) return String(next);
	return '';
}

function readCandidateList(data: unknown): IDataObject[] {
	if (!Array.isArray(data)) return [];
	return data.filter(
		(item): item is IDataObject => !!item && typeof item === 'object' && !Array.isArray(item),
	);
}

function buildFilterBody(filters: IDataObject): IDataObject {
	const body: IDataObject = {};

	const email = parseOptionalString(filters.email);
	const phone = parseOptionalString(filters.phone);
	const applicationIds = parseIntegerList(filters.applicationIds, '申请 ID 列表');
	const pipelineIds = parseIntegerList(filters.pipelineIds, '流程 ID 列表');
	const stageIds = parseIntegerList(filters.stageIds, '阶段 ID 列表');
	const hireMode = parseEnumInt(filters.hireMode, [1, 2], '招聘模式');
	const archived = parseOptionalBoolean(filters.archived, '是否归档');
	const invitationUpdateStatus = parseEnumInt(
		filters.invitationUpdateStatus,
		[0, 1, 2],
		'邀请更新状态',
	);
	const offerAttachment = parseOptionalBoolean(filters.offerAttachment, '返回 Offer 附件');
	const applicationForm = parseOptionalBoolean(filters.applicationForm, '返回登记表');
	const needAttachment = parseOptionalBoolean(filters.needAttachment, '返回附件');

	if (email) body.email = email;
	if (phone) body.phone = phone;
	if (applicationIds.length > 0) body.applicationIds = applicationIds;
	if (pipelineIds.length > 0) body.pipelineIds = pipelineIds;
	if (stageIds.length > 0) body.stageIds = stageIds;
	if (hireMode !== undefined) body.hireMode = hireMode;
	if (archived !== undefined) body.archived = archived;
	if (invitationUpdateStatus !== undefined) body.invitationUpdateStatus = invitationUpdateStatus;
	if (offerAttachment !== undefined) body.offerAttachment = offerAttachment;
	if (applicationForm !== undefined) body.applicationForm = applicationForm;
	if (needAttachment !== undefined) body.needAttachment = needAttachment;

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
		body[range.startKey] = range.asBeijingString ? formatBeijingIso(start) : start;
		body[range.endKey] = range.asBeijingString ? formatBeijingIso(end) : end;
	}

	return body;
}

const booleanChoice = [
	{ name: '不传', value: '' },
	{ name: '是', value: 'true' },
	{ name: '否', value: 'false' },
];

const operation: ResourceOperations = {
	name: '获取候选人信息V2接口(不迭代)',
	value: 'getInfoV2',
	description: '按条件查询候选人申请详情，不用于增量拉取',
	action: '',
	order: 81,
	options: [
		{
			displayName:
				'筛选条件均可选。接口每页最多 20 条，按 next 翻页。更新时间会转成北京时间。这是查询接口，不是增量拉取。Offer 附件链接需单独打开，一小时有效。',
			name: 'noticeGetInfoV2',
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
					placeholder: '236718928',
					description: '申请 ID。可填写逗号或换行拼接的字符串，或用表达式返回数组',
				},
				{
					displayName: '邮箱',
					name: 'email',
					type: 'string',
					default: '',
					placeholder: 'name@example.com',
					description: '候选人邮箱',
				},
				{
					displayName: '手机号',
					name: 'phone',
					type: 'string',
					default: '',
					placeholder: '13800000000',
					description: '候选人手机号',
				},
				{
					displayName: '流程 ID 列表',
					name: 'pipelineIds',
					type: 'string',
					default: '',
					placeholder: '410006067',
					description: '流程 ID。可填写逗号或换行拼接的字符串，或用表达式返回数组',
				},
				{
					displayName: '阶段 ID 列表',
					name: 'stageIds',
					type: 'string',
					default: '',
					placeholder: '410012144',
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
					description: '社招为 1，校招为 2。其它值视为不传',
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
					description: '需和结束时间一起填。请求里转成北京时间，格式 YYYY-MM-DDTHH:mm:ss.sssZ',
				},
				{
					displayName: '更新结束时间',
					name: 'updateAtEndTime',
					type: 'dateTime',
					default: '',
					description: '需和开始时间一起填。请求里转成北京时间，格式 YYYY-MM-DDTHH:mm:ss.sssZ',
				},
				{
					displayName: '数据创建开始时间',
					name: 'applicationCreateStartTime',
					type: 'dateTime',
					default: '',
					description: '申请首次写入数据库的开始时间。需和结束时间一起填，请求里为毫秒时间戳',
				},
				{
					displayName: '数据创建结束时间',
					name: 'applicationCreateEndTime',
					type: 'dateTime',
					default: '',
					description: '申请首次写入数据库的结束时间。需和开始时间一起填，请求里为毫秒时间戳',
				},
				{
					displayName: '申请创建开始时间',
					name: 'applicationAppliedAtStartTime',
					type: 'dateTime',
					default: '',
					description: '系统展示的申请日期开始时间。需和结束时间一起填，请求里为毫秒时间戳',
				},
				{
					displayName: '申请创建结束时间',
					name: 'applicationAppliedAtEndTime',
					type: 'dateTime',
					default: '',
					description: '系统展示的申请日期结束时间。需和开始时间一起填，请求里为毫秒时间戳',
				},
				{
					displayName: '返回 Offer 附件',
					name: 'offerAttachment',
					type: 'options',
					default: '',
					options: booleanChoice,
					description: '只有为是时才返回 Offer 附件下载链接，一小时有效',
				},
				{
					displayName: '返回登记表',
					name: 'applicationForm',
					type: 'options',
					default: '',
					options: booleanChoice,
					description: '只有为是时才返回候选人自定义样式登记表',
				},
				{
					displayName: '返回附件',
					name: 'needAttachment',
					type: 'options',
					default: '',
					options: booleanChoice,
					description: '不传时接口默认返回附件。否表示不返回附件',
				},
			],
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

		const requestPage = async (cursor: string, pageSize: number): Promise<IEhrPage> => {
			const response = await mokaRequest<IEhrPage>(this, {
				method: 'POST',
				path: PATH,
				body: cursor ? { next: cursor } : { ...filterBody, limit: pageSize },
				itemIndex: index,
				timeout,
				returnFullResponse: true,
			});
			return response && typeof response === 'object' ? response : {};
		};

		const readPage = (page: IEhrPage) => ({
			list: readCandidateList(page.data),
			next: readNextCursor(page.next),
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
