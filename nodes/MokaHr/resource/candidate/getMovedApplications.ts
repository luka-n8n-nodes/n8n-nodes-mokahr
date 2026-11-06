import { IDataObject, NodeOperationError } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import { mokaRequest } from '../../../help/utils/MokaRequest';
import { proxyOption, readRequestOptions, timeoutOption } from '../../../help/utils/sharedOptions';

/**
 * 获取全部阶段下的候选人信息
 * GET /api-platform/v1/data/moved_applications
 * https://www.mokahr.com/docs/api/view/v2.html#-7
 *
 * 只返回基础信息，没有附件链接。每次最多 100 条。
 * 返回后会标记候选人，标记后在阶段移动前不能再通过本接口取到。
 * 示例响应是数组，没有业务 code。线上会返回 code 0 且 msg 为 success。
 */

const PATH = '/api-platform/v1/data/moved_applications';
const STAGES = [
	'all',
	'preliminary_filter',
	'offer',
	'pending_checkin',
	'filter',
	'interview',
	'exam',
	'none',
	'shigong',
] as const;

function parseOptionalString(raw: unknown): string | undefined {
	if (raw === undefined || raw === null) return undefined;
	const text = String(raw).trim();
	return text ? text : undefined;
}

/**
 * 日期选择器按本机日历日转成文档示例那样的 YYYY-M-D。
 * 已经是日期的字符串原样使用。
 */
function formatApiDate(raw: unknown, label: string): string | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;
	if (typeof raw === 'string') {
		const text = raw.trim();
		if (!text) return undefined;
		if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) return text;
		if (/^\d+$/.test(text)) return formatApiDate(Number(text), label);
	}

	const ms = typeof raw === 'number' ? raw : Date.parse(String(raw));
	if (!Number.isFinite(ms)) throw new Error(`${label}不是有效时间`);
	const date = new Date(ms);
	return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function isRecord(value: unknown): value is IDataObject {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readList(response: unknown): IDataObject[] {
	if (Array.isArray(response)) return response.filter(isRecord);
	if (!isRecord(response)) return [];
	if (response.success === false) {
		throw new Error(String(response.msg || response.message || '获取全部阶段下的候选人信息失败'));
	}
	return Array.isArray(response.data) ? response.data.filter(isRecord) : [];
}

function buildPath(stage: string | undefined, fromTime: string | undefined): string {
	const search = new URLSearchParams();
	if (stage) search.set('stage', stage);
	if (fromTime) search.set('fromTime', fromTime);
	const qs = search.toString();
	return qs ? `${PATH}?${qs}` : PATH;
}

const operation: ResourceOperations = {
	name: '获取全部阶段下的候选人信息',
	value: 'getMovedApplications',
	description: '按阶段拉取未标记候选人的基础信息，返回后会标记',
	action: '',
	order: 82,
	options: [
		{
			displayName:
				'只返回基础信息，不含附件链接。每次最多 100 条。返回后会标记候选人，标记后在其移动阶段前不会再被本接口返回。还有未标记数据时，再执行一次即可继续取。',
			name: 'noticeGetMovedApplications',
			type: 'notice',
			default: '',
		},
		{
			displayName: '阶段',
			name: 'stage',
			type: 'options',
			default: '',
			// 阶段按招聘流程排列，不按名称字母序
			// eslint-disable-next-line n8n-nodes-base/node-param-options-type-unsorted-items
			options: [
				{ name: '不筛选', value: '' },
				{ name: '所有阶段', value: 'all' },
				{ name: '初筛', value: 'preliminary_filter' },
				{ name: 'Offer', value: 'offer' },
				{ name: '待入职', value: 'pending_checkin' },
				{ name: '筛选型', value: 'filter' },
				{ name: '面试型', value: 'interview' },
				{ name: '测试型', value: 'exam' },
				{ name: '无类型', value: 'none' },
				{ name: '试工型', value: 'shigong' },
			],
			description: '按归档前阶段过滤。不选则不传',
		},
		{
			displayName: '开始时间',
			name: 'fromTime',
			type: 'dateTime',
			default: '',
			description: '只返回该日期之后的数据。按本机日历日转成 YYYY-M-D，例如 2018-1-1',
		},
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			options: [timeoutOption(), proxyOption],
		},
	],
	call: async function (index) {
		const { timeout, proxy } = readRequestOptions.call(this, index);

		let stage: string | undefined;
		let fromTime: string | undefined;
		try {
			stage = parseOptionalString(this.getNodeParameter('stage', index, ''));
			if (stage && !STAGES.includes(stage as (typeof STAGES)[number])) {
				throw new Error('阶段不在可选范围内');
			}
			fromTime = formatApiDate(this.getNodeParameter('fromTime', index, ''), '开始时间');
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				error instanceof Error ? error.message : String(error),
				{ itemIndex: index },
			);
		}

		const response = await mokaRequest<unknown>(this, {
			method: 'GET',
			path: buildPath(stage, fromTime),
			itemIndex: index,
			timeout,
			proxy,
			returnFullResponse: true,
			successCodes: [0, 200],
		});

		try {
			return readList(response);
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				error instanceof Error ? error.message : String(error),
				{ itemIndex: index },
			);
		}
	},
};

export default operation;
