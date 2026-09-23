import { IDataObject, NodeOperationError } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import { mokaRequest } from '../../../help/utils/MokaRequest';
import { timeoutOption } from '../../../help/utils/sharedOptions';

/**
 * 根据邮箱、手机号、身份证号查询申请信息（最多返回一百条）
 * POST /api-platform/v3/applications/list_by_contact_or_id
 * https://www.mokahr.com/docs/api/#-166
 */

const PATH = '/api-platform/v3/applications/list_by_contact_or_id';
const MAX_LIST_LENGTH = 20;

interface IApplicationListData {
	applicationList?: IDataObject[];
}

/**
 * 解析字符串列表。
 * 固定值可以是逗号、换行分隔的字符串；表达式可以直接返回字符串数组。
 * 空值返回空数组。
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

const operation: ResourceOperations = {
	name: '根据邮箱、手机号、身份证号查询申请信息',
	value: 'listByContactOrId',
	description: '按邮箱、手机号或证件号查询申请，最多返回 100 条',
	action: '',
	order: 10,
	options: [
		{
			displayName: '最多返回 100 条申请。邮箱、手机号、证件号至少填写一项，每项最多 20 个。',
			name: 'noticeListByContact',
			type: 'notice',
			default: '',
		},
		{
			displayName: '邮箱列表',
			name: 'emailList',
			type: 'string',
			default: '',
			placeholder: 'a@example.com,b@example.com',
			description: '候选人邮箱，最多 20 个。可填写逗号或换行拼接的字符串，或用表达式返回字符串数组',
		},
		{
			displayName: '手机号列表',
			name: 'phoneList',
			type: 'string',
			default: '',
			placeholder: '13800000000,13900000000',
			description: '候选人手机号，最多 20 个。可填写逗号或换行拼接的字符串，或用表达式返回字符串数组',
		},
		{
			displayName: '证件号列表',
			name: 'citizenIdList',
			type: 'string',
			default: '',
			placeholder: '110101199001011234',
			description: '候选人证件号，最多 20 个。可填写逗号或换行拼接的字符串，或用表达式返回字符串数组',
		},
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			options: [timeoutOption()],
		},
	],
	call: async function (index) {
		const emailList = parseStringList(this.getNodeParameter('emailList', index, ''));
		const phoneList = parseStringList(this.getNodeParameter('phoneList', index, ''));
		const citizenIdList = parseStringList(this.getNodeParameter('citizenIdList', index, ''));
		const optionsParam = this.getNodeParameter('options', index, {}) as { timeout?: number };
		const timeout = Number(optionsParam.timeout ?? 0) > 0 ? Number(optionsParam.timeout) : 0;

		const lists: Array<[string, string[]]> = [
			['邮箱列表', emailList],
			['手机号列表', phoneList],
			['证件号列表', citizenIdList],
		];

		for (const [label, list] of lists) {
			if (list.length > MAX_LIST_LENGTH) {
				throw new NodeOperationError(
					this.getNode(),
					`${label} 最多 ${MAX_LIST_LENGTH} 个，当前 ${list.length} 个`,
					{ itemIndex: index },
				);
			}
		}

		if (emailList.length + phoneList.length + citizenIdList.length === 0) {
			throw new NodeOperationError(this.getNode(), '邮箱、手机号、证件号不允许全部为空', {
				itemIndex: index,
			});
		}

		const body: IDataObject = {};
		if (emailList.length > 0) body.emailList = emailList;
		if (phoneList.length > 0) body.phoneList = phoneList;
		if (citizenIdList.length > 0) body.citizenIdList = citizenIdList;

		const data = await mokaRequest<IApplicationListData>(this, {
			method: 'POST',
			path: PATH,
			body,
			itemIndex: index,
			timeout,
		});

		return Array.isArray(data?.applicationList) ? data.applicationList : [];
	},
};

export default operation;
