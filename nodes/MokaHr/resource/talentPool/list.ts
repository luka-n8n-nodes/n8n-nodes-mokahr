import { IDataObject, NodeOperationError } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import { mokaRequest } from '../../../help/utils/MokaRequest';
import {
	proxyOption,
	readRequestOptions,
	requestBatchingOption,
	timeoutOption,
} from '../../../help/utils/sharedOptions';

/**
 * 查询人才库列表
 * GET /api-platform/v1/talentPool/list
 * https://www.mokahr.com/docs/api/
 *
 * 不传 range 时可能直接返回数组，字段是 hire_mode。
 * 传入 range 视为新版，响应为 { success, msg, data }，字段是 hireMode，并带 creatorId、authUsers。
 * 示例响应没有业务 code，用 success 表示是否成功。
 */

const PATH = '/api-platform/v1/talentPool/list';
const RANGES = ['open', 'all'] as const;
type TalentPoolRange = (typeof RANGES)[number];

interface ITalentPoolListResponse {
	success?: boolean;
	code?: number;
	msg?: string;
	message?: string;
	data?: IDataObject[];
}

function parseHireMode(raw: unknown): number | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;
	const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
	if (value !== 1 && value !== 2) {
		throw new Error('招聘模式只能是全部、社招或校招');
	}
	return value;
}

function parseRange(raw: unknown): TalentPoolRange {
	const text = String(raw ?? '')
		.trim()
		.toLowerCase();
	const matched = RANGES.find((item) => item === text);
	if (!matched) {
		throw new Error('返回范围只能是全部人才库或公共人才库');
	}
	return matched;
}

function readTalentPools(response: unknown): IDataObject[] {
	if (Array.isArray(response)) return response as IDataObject[];
	if (!response || typeof response !== 'object') return [];

	const body = response as ITalentPoolListResponse;
	if (body.success === false) {
		throw new Error(body.msg || body.message || '查询人才库列表失败');
	}
	return Array.isArray(body.data) ? body.data : [];
}

const operation: ResourceOperations = {
	name: '查询人才库列表',
	value: 'list',
	description: '查询当前客户下的人才库',
	action: '',
	order: 10,
	options: [
		{
			displayName:
				'返回当前客户下的人才库，每条库输出一项。默认包含入职库和黑名单。请求会带上返回范围，走新版响应，包含创建者和授权用户。',
			name: 'noticeListTalentPools',
			type: 'notice',
			default: '',
		},
		{
			displayName: '招聘模式',
			name: 'hireMode',
			type: 'options',
			default: '',
			options: [
				{ name: '全部', value: '' },
				{ name: '社招', value: '1' },
				{ name: '校招', value: '2' },
			],
			description: '1 社招，2 校招。选全部时不传，社招和校招都返回',
		},
		{
			displayName: '返回范围',
			name: 'range',
			type: 'options',
			default: 'all',
			options: [
				{ name: '全部人才库', value: 'all' },
				{ name: '公共人才库', value: 'open' },
			],
			description: '全部包含入职库和黑名单。公共人才库不包含这两类',
		},
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			options: [requestBatchingOption, timeoutOption(), proxyOption],
		},
	],
	call: async function (index) {
		const { timeout, proxy } = readRequestOptions.call(this, index);

		let hireMode: number | undefined;
		let range: TalentPoolRange;
		try {
			hireMode = parseHireMode(this.getNodeParameter('hireMode', index, ''));
			range = parseRange(this.getNodeParameter('range', index, 'all'));
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				error instanceof Error ? error.message : String(error),
				{ itemIndex: index },
			);
		}

		const params = new URLSearchParams();
		if (hireMode !== undefined) params.set('hireMode', String(hireMode));
		params.set('range', range);

		const response = await mokaRequest<ITalentPoolListResponse | IDataObject[]>(this, {
			method: 'GET',
			path: `${PATH}?${params.toString()}`,
			itemIndex: index,
			timeout,
			proxy,
			returnFullResponse: true,
			successCodes: [0, 200],
		});

		try {
			return readTalentPools(response);
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
