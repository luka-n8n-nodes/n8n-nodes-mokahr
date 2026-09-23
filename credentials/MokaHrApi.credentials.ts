import { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Moka Hr 招聘 Open API 凭证。
 *
 * 只保存系统版本与 Authorization。密钥配置页给出的 value 已是
 * `Basic <base64>`，请求时原样放入请求头，不再编码。
 */
export class MokaHrApi implements ICredentialType {
	name = 'mokaHrApi';
	displayName = 'Moka Hr API';
	documentationUrl = 'https://www.mokahr.com/docs/api/';
	icon = 'file:../nodes/MokaHr/icon.svg' as const;
	properties: INodeProperties[] = [
		{
			displayName: '系统版本',
			name: 'region',
			type: 'options',
			options: [
				{
					name: '中国版',
					value: 'china',
					description: 'https://api.mokahr.com',
				},
				{
					name: '国际版',
					value: 'international',
					description: 'https://hire-r1-api.mokahr.com',
				},
			],
			default: 'china',
			required: true,
			description: '按实际使用的 Moka 系统版本选择域名',
		},
		{
			displayName: 'Authorization',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description:
				'在 Moka 密钥配置中复制 Authorization 的 value，形如 Basic xxxxx。节点会原样放入请求头，不再 Base64',
		},
	];
}
