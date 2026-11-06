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
 * 查询简历筛选评价表
 * POST /api-platform/pipeline/assignment/get
 * https://www.mokahr.com/docs/api/#-158
 *
 * 文档示例的成功码是 0，线上实际也会返回 200 且 msg 为 success。两者都视为成功。
 */

const PATH = '/api-platform/pipeline/assignment/get';

const operation: ResourceOperations = {
	name: '查询简历筛选评价表',
	value: 'getScreeningForms',
	description: '按招聘模式查询简历筛选评价表及评价选项',
	action: '',
	order: 60,
	options: [
		{
			displayName:
				'按社招或校招返回评价表。每张表输出一项，选项在 feedbackResultList 里。type：accept 正面，reject 负面，decided 中性。',
			name: 'noticeGetScreeningForms',
			type: 'notice',
			default: '',
		},
		{
			displayName: '招聘模式',
			name: 'hireMode',
			type: 'options',
			default: 1,
			options: [
				{ name: '社招', value: 1 },
				{ name: '校招', value: 2 },
			],
			description: '1 社招，2 校招',
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
		const hireMode = Number(this.getNodeParameter('hireMode', index));
		const { timeout, proxy } = readRequestOptions.call(this, index);

		if (hireMode !== 1 && hireMode !== 2) {
			throw new NodeOperationError(this.getNode(), '招聘模式只能是社招或校招', {
				itemIndex: index,
			});
		}

		const data = await mokaRequest<IDataObject[]>(this, {
			method: 'POST',
			path: PATH,
			body: { hireMode },
			itemIndex: index,
			timeout,
			proxy,
			successCodes: [0, 200],
		});

		return Array.isArray(data) ? data : [];
	},
};

export default operation;
