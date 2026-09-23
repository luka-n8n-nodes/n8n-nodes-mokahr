import { globSync } from 'glob';
import path from 'path';

/**
 * 模块动态加载工具：通过 glob 表达式从指定目录扫描已编译的 .js 文件，
 * require 后返回每个模块的 default export 列表（带 order 默认值）。
 */
class ModuleLoadUtils {
	static loadModules(dirPath: string, expression: string) {
		const files = globSync(expression, {
			cwd: dirPath,
		});

		const modules = [];
		for (const file of files) {
			const fullpath = path.resolve(dirPath, file);
			const filepath = path.relative(__dirname, fullpath);
			const module = require(filepath);
			modules.push({
				order: 100,
				...module.default,
			});
		}

		return modules;
	}
}

export default ModuleLoadUtils;
