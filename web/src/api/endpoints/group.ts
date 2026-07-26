import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import { logger } from '@/lib/logger';

/**
 * 分组项信息
 */
export interface GroupItem {
    id?: number;
    group_id?: number;
    channel_id: number;
    model_name: string;
    priority: number;
    weight: number;
}

/**
 * 分组模式
 */
export enum GroupMode {
    RoundRobin = 1,
    Random = 2,
    Failover = 3,
    Weighted = 4,
}

/**
 * 分组信息
 */
export interface Group {
    id?: number;
    name: string;
    mode: GroupMode;
    match_regex: string;
    first_token_time_out?: number;
    session_keep_time?: number;
    items?: GroupItem[];
}

/**
 * 新增 item 请求
 */
export interface GroupItemAddRequest {
    channel_id: number;
    model_name: string;
    priority: number;
    weight: number;
}

/**
 * 更新 item 请求 (仅 priority)
 */
export interface GroupItemUpdateRequest {
    id: number;
    priority: number;
    weight: number;
}

/**
 * 分组更新请求 - 仅包含变更的数据
 */
export interface GroupUpdateRequest {
    id: number;
    name?: string;                        // 仅在名称变更时发送
    mode?: GroupMode;                     // 仅在模式变更时发送
    match_regex?: string;                 // 仅在匹配正则变更时发送
    first_token_time_out?: number;        // 仅在超时变更时发送
    session_keep_time?: number;           // 仅在会话保持时间变更时发送
    items_to_add?: GroupItemAddRequest[];    // 新增的 items
    items_to_update?: GroupItemUpdateRequest[]; // 更新的 items (priority 变更)
    items_to_delete?: number[];              // 删除的 item IDs
}

/**
 * 获取分组列表 Hook
 * 
 * @example
 * const { data: groups, isLoading, error } = useGroupList();
 * 
 * if (isLoading) return <Loading />;
 * if (error) return <Error message={error.message} />;
 * 
 * groups?.forEach(group => console.log(group.name, group.items));
 */
export function useGroupList() {
    return useQuery({
        queryKey: ['groups', 'list'],
        queryFn: async () => {
            return apiClient.get<Group[]>('/api/v1/group/list');
        },
        refetchInterval: 30000,
        refetchOnMount: 'always',
    });
}

/**
 * 创建分组 Hook
 * 
 * @example
 * const createGroup = useCreateGroup();
 * 
 * createGroup.mutate({
 *   name: 'my-group',
 *   items: [
 *     { channel_id: 1, model_name: 'gpt-4', priority: 1 },
 *   ],
 * });
 */
export function useCreateGroup() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: Group) => {
            return apiClient.post<Group>('/api/v1/group/create', data);
        },
        onSuccess: (data) => {
            logger.log('分组创建成功:', data);
            queryClient.invalidateQueries({ queryKey: ['groups', 'list'] });
        },
        onError: (error) => {
            logger.error('分组创建失败:', error);
        },
    });
}

/**
 * 更新分组 Hook - 仅发送变更的数据
 * 
 * @example
 * const updateGroup = useUpdateGroup();
 * 
 * updateGroup.mutate({
 *   id: 1,
 *   name: 'updated-group',  // 可选，仅在名称变更时发送
 *   items_to_add: [{ channel_id: 1, model_name: 'gpt-4', priority: 1 }],
 *   items_to_update: [{ id: 1, priority: 2 }],
 *   items_to_delete: [2, 3],
 * });
 */
export function useUpdateGroup() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: GroupUpdateRequest) => {
            return apiClient.post<Group>('/api/v1/group/update', data);
        },
        onSuccess: (data) => {
            logger.log('分组更新成功:', data);
            queryClient.invalidateQueries({ queryKey: ['groups', 'list'] });
        },
        onError: (error) => {
            logger.error('分组更新失败:', error);
        },
    });
}

/**
 * 删除分组 Hook
 * 
 * @example
 * const deleteGroup = useDeleteGroup();
 * 
 * deleteGroup.mutate(1); // 删除 ID 为 1 的分组
 */
export function useDeleteGroup() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: number) => {
            return apiClient.delete<null>(`/api/v1/group/delete/${id}`);
        },
        onSuccess: () => {
            logger.log('分组删除成功');
            queryClient.invalidateQueries({ queryKey: ['groups', 'list'] });
        },
        onError: (error) => {
            logger.error('分组删除失败:', error);
        },
    });
}

/**
 * 单项验证结果
 */
export interface ModelValidationResult {
    channel_id: number;
    model_name: string;
    passed: boolean;
    error?: string;
    latency_ms: number;
}

/**
 * 添加模型并验证请求
 */
export interface AddModelsWithValidationRequest {
    group_id: number;
    items_to_validate: GroupItemAddRequest[];
    validate_only?: boolean;
    /** 单次验证的超时（秒），<=0 时后端使用全局默认。 */
    timeout_seconds?: number;
}

/**
 * 添加模型并验证响应
 */
export interface AddModelsWithValidationResponse {
    results: ModelValidationResult[];
}

/**
 * 自动添加分组 item Hook
 *
 * 后端路由: POST /api/v1/group/auto-add-item
 * Body: { id: number }
 *
 * @example
 * const autoAdd = useAutoAddGroupItem();
 * autoAdd.mutate(1); // 为 groupId=1 自动添加匹配的 items
 */
// export function useAutoAddGroupItem() {
//     const queryClient = useQueryClient();

//     return useMutation({
//         mutationFn: async (groupId: number) => {
//             return apiClient.post<null>(`/api/v1/group/auto-add-item`, { id: groupId });
//         },
//         onSuccess: () => {
//             logger.log('自动添加分组 item 成功');
//             queryClient.invalidateQueries({ queryKey: ['groups', 'list'] });
//         },
//         onError: (error) => {
//             logger.error('自动添加分组 item 失败:', error);
//         },
//     });
// }

/**
 * 渠道模型验证请求
 */
export interface ChannelTestRequest {
    channel_id: number;
    /** 单次验证的超时（秒），<=0 时后端使用全局默认。 */
    timeout_seconds?: number;
}

/**
 * 渠道模型验证响应
 */
export interface ChannelTestResponse {
    results: ModelValidationResult[];
}

/**
 * 渠道测试连接 Hook
 *
 * 后端路由: POST /api/v1/channel/test
 * Body: { channel_id, timeout_seconds }
 * Response: { results: [{channel_id, model_name, passed, error, latency_ms}] }
 */
export function useChannelTest() {
    return useMutation({
        mutationFn: async (data: ChannelTestRequest) => {
            return apiClient.post<ChannelTestResponse>(
                '/api/v1/channel/test',
                data,
            );
        },
        onError: (error) => {
            logger.error('渠道测试失败:', error);
        },
    });
}

/**
 * 添加模型并验证 Hook（首 Token 测试）
 *
 * 后端路由: POST /api/v1/group/add-models-with-validation
 * Body: { group_id, items_to_validate: [{channel_id, model_name, priority, weight}], validate_only }
 * Response: { results: [{channel_id, model_name, passed, error}] }
 *
 * 注意：此接口会在服务端做真实首 Token 测试，每项模型最多等待 model_validation_timeout 秒。
 * 仅 `passed=true` 的项会被写入分组（当 validate_only=false）。
 *
 * @example
 * const validate = useAddModelsWithValidation();
 * validate.mutate({ group_id: 0, items_to_validate: [{channel_id: 1, model_name: 'gpt-4', priority: 1, weight: 1}] });
 */
export function useAddModelsWithValidation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: AddModelsWithValidationRequest) => {
            return apiClient.post<AddModelsWithValidationResponse>(
                '/api/v1/group/add-models-with-validation',
                data,
            );
        },
        onSuccess: (data) => {
            logger.log('模型验证完成:', data);
            queryClient.invalidateQueries({ queryKey: ['groups', 'list'] });
        },
        onError: (error) => {
            logger.error('模型验证失败:', error);
        },
    });
}



