/**
 * 凭证类型常量。
 */
export const Credentials = {
	MokaHrApi: 'mokaHrApi',
} as const;
export type CredentialsKey = (typeof Credentials)[keyof typeof Credentials];

/** 中国版 / 国际版 Open API 域名 */
export const RegionBaseUrls = {
	china: 'https://api.mokahr.com',
	international: 'https://hire-r1-api.mokahr.com',
} as const;

export type MokahrRegion = keyof typeof RegionBaseUrls;

/**
 * Moka ATS Open API 成功码。文档约定 200 为成功，其它均为错误。
 */
export const MokaSuccessCodes: ReadonlyArray<number> = [200];
