/**
 * Provider 注册工厂
 *
 * 根据 enabledProviders 白名单，创建并注册 Provider 到 SessionManager。
 * 未在白名单中的 provider 不注册，也不参与 provider 选择。
 */
import type { Logger } from "../logger.js";
import type { SessionManager } from "../session-manager.js";
import type { ProviderName } from "./provider.js";
/**
 * 创建并注册 provider 到 SessionManager。
 *
 * @param enabledProviders 白名单。空数组=全部启用。
 */
export declare function createAndRegisterProviders(sm: SessionManager, logger: Logger, enabledProviders?: ProviderName[]): void;
