'use client';

import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { Check, ChevronDownIcon, Loader2, Plus, Search, Sparkles, Trash2, X, Zap, ArrowUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { useModelChannelList, type LLMChannel } from '@/api/endpoints/model';
import {
    useAddModelsWithValidation,
    useChannelTest as useChannelTestMutation,
} from '@/api/endpoints/group';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionContent, AccordionItem } from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { getModelIcon } from '@/lib/model-icons';
import type { GroupMode } from '@/api/endpoints/group';
import type { SelectedMember } from './ItemList';
import { MemberList } from './ItemList';
import { matchesGroupName, memberKey, normalizeKey, MODE_LABELS } from './utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/animate-ui/components/animate/tooltip';
import { HelpCircle } from 'lucide-react';
import { toast } from '@/components/common/Toast';



export type GroupEditorValues = {
    name: string;
    match_regex: string;
    mode: GroupMode;
    first_token_time_out: number;
    session_keep_time: number;
    members: SelectedMember[];
};

function ModelPickerSection({
    modelChannels,
    selectedMembers,
    onAdd,
    onAutoAdd,
    autoAddDisabled,
    pendingKeys,
    failedMap,
    onBatchTest,
    isBatchTesting,
    onTestChannel,
    testingChannelId,
}: {
    modelChannels: LLMChannel[];
    selectedMembers: SelectedMember[];
    onAdd: (channel: LLMChannel) => void;
    onAutoAdd: () => void;
    autoAddDisabled: boolean;
    pendingKeys: Set<string>;
    failedMap: Map<string, string>;
    onBatchTest: (models: LLMChannel[]) => void;
    isBatchTesting: boolean;
    onTestChannel: (channelId: number, models: LLMChannel[]) => void;
    testingChannelId: number | null;
}) {
    const t = useTranslations('group');
    const [searchKeyword, setSearchKeyword] = useState('');
const [expandedChannels, setExpandedChannels] = useState<Set<number>>(new Set());
// const [openChannelIds, setOpenChannelIds] = useState<Set<number>>(new Set());

    const selectedKeys = useMemo(() => new Set(selectedMembers.map(memberKey)), [selectedMembers]);
    const normalizedSearch = searchKeyword.trim().toLowerCase();

    const channels = useMemo(() => {
        const byId = new Map<number, { id: number; name: string; models: LLMChannel[] }>();
        modelChannels.forEach((mc) => {
            if (!mc.enabled) return; // 跳过禁用的模型
            const existing = byId.get(mc.channel_id);
            if (existing) existing.models.push(mc);
            else byId.set(mc.channel_id, { id: mc.channel_id, name: mc.channel_name, models: [mc] });
        });

        return Array.from(byId.values())
            .map((c) => ({ ...c, models: [...c.models].sort((a, b) => {
                const la = (a as any).latency_ms ?? Number.MAX_VALUE;
                const lb = (b as any).latency_ms ?? Number.MAX_VALUE;
                return la - lb;
            }) }))
            .sort((a, b) => a.id - b.id);
    }, [modelChannels]);

    const filteredChannels = useMemo(() => {
        if (!normalizedSearch) return channels;
        return channels.reduce<typeof channels>((acc, channel) => {
            if (channel.name.toLowerCase().includes(normalizedSearch)) {
                acc.push(channel);
                return acc;
            }

            const models = channel.models.filter((model) => model.name.toLowerCase().includes(normalizedSearch));
            if (models.length > 0) acc.push({ ...channel, models });
            return acc;
        }, []);
    }, [channels, normalizedSearch]);

    const modelsToBatchTest = useMemo(() => {
        const toTest: LLMChannel[] = [];
        filteredChannels.forEach((channel) => {
            channel.models.forEach((m) => {
                const key = memberKey(m);
                if (!selectedKeys.has(key)) {
                    toTest.push(m);
                }
            });
        });
        return toTest;
    }, [filteredChannels, selectedKeys]);

    return (
        <div className="rounded-xl border border-border/50 bg-muted/30 flex flex-col min-h-0">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 border-b border-border/30 bg-muted/50">
                <span className="min-w-0 justify-self-start text-sm font-medium text-foreground">
                    {t('form.addItem')}
                </span>

                <div className="relative justify-self-center w-30">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={searchKeyword}
                        onChange={(event) => setSearchKeyword(event.target.value)}
                        className="h-6 rounded-lg border-border/60 bg-background/70 pl-7 pr-2 text-xs shadow-none focus-visible:border-border/60 focus-visible:ring-0"
                        aria-label="search"
                    />
                </div>

                <div className="justify-self-end shrink-0 flex items-center gap-1.5">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    onClick={() => onBatchTest(modelsToBatchTest)}
                                    disabled={isBatchTesting || modelsToBatchTest.length === 0}
                                    className={cn(
                                        'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors',
                                        isBatchTesting || modelsToBatchTest.length === 0
                                            ? 'text-muted-foreground/50 cursor-not-allowed'
                                            : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                                    )}
                                    title={modelsToBatchTest.length === 0 ? t('form.testConnectionNoMembers') : t('form.testConnection')}
                                >
                                    {isBatchTesting ? (
                                        <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                        <Zap className="size-3.5" />
                                    )}
                                    <span>{t('form.testConnection')}</span>
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>{t('form.testConnection')}</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <button
                        type="button"
                        onClick={onAutoAdd}
                        className={cn(
                            'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors',
                            autoAddDisabled
                                ? 'text-muted-foreground/50 cursor-not-allowed'
                                : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                        )}
                        disabled={autoAddDisabled}
                        title={t('form.autoAdd')}
                    >
                        <Sparkles className="size-3.5" />
                        <span>{t('form.autoAdd')}</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2">
                <Accordion type="multiple" className="w-full space-y-2">
                    {filteredChannels.map((channel) => {
                        const total = channel.models.length;
                        const selectedCount = channel.models.reduce(
                            (acc, m) => acc + (selectedKeys.has(memberKey(m)) ? 1 : 0),
                            0
                        );
                        const available = total - selectedCount;

                        return (
                            <AccordionItem key={channel.id} value={`channel-${channel.id}`}>
                                <AccordionPrimitive.Header className="rounded-lg bg-muted sticky top-0 z-10 flex px-2 overflow-hidden">
                                    <AccordionPrimitive.Trigger className="flex flex-1 min-w-0 items-center gap-4 py-4 text-left text-sm transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180">
                                        <span className="truncate">{channel.name}</span>
                                        <span className="text-xs text-muted-foreground shrink-0">
                                            {available}/{total}
                                        </span>
                                        <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4 shrink-0 transition-transform duration-200" />
                                    </AccordionPrimitive.Trigger>
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button
                                                    type="button"
                                                    onClick={() => onTestChannel(channel.id, channel.models)}
                                                    disabled={testingChannelId !== null || channel.models.length === 0}
                                                    className={cn(
                                                        'shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors',
                                                        testingChannelId !== null
                                                            ? 'text-muted-foreground/50 cursor-not-allowed'
                                                            : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                                                    )}
                                                >
                                                    {testingChannelId !== null ? (
                                                        <Loader2 className="size-3.5 animate-spin" />
                                                    ) : (
                                                        <Zap className="size-3.5" />
                                                    )}
                                                    <span>{t('form.testChannel')}</span>
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent>{t('form.testConnection')}</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </AccordionPrimitive.Header>
                                <AccordionContent className="px-2 pt-2">
                                    <div className="flex flex-col gap-1.5">
                                        {channel.models.map((m) => {
                                            const key = memberKey(m);
                                            const isSelected = selectedKeys.has(key);
                                            const isPending = pendingKeys.has(key);
                                            const failureMsg = failedMap.get(key);
                                            const { Avatar } = getModelIcon(m.name);
                                            return (
                                                <div key={key} className="space-y-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => !isSelected && !isPending && onAdd(m)}
                                                        disabled={isSelected || isPending}
                                                        className={cn(
                                                            'w-full flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background px-2.5 py-2 text-left transition-colors',
                                                            isSelected || isPending ? 'opacity-60 cursor-not-allowed' : 'hover:bg-muted'
                                                        )}
                                                    >
                                                        <span className="flex items-center gap-2 min-w-0">
                                                            <Avatar size={16} />
                                                            <span className="text-sm font-medium truncate">{m.name}</span>
                                                        </span>

                                                        <span className="shrink-0 text-muted-foreground">
                                                            {isPending ? (
                                                                <Loader2 className="size-4 animate-spin" />
                                                            ) : isSelected ? (
                                                                <Check className="size-4 text-primary" />
                                                            ) : (
                                                                <Plus className="size-4" />
                                                            )}
                                                        </span>
                                                    </button>
                                                    {failureMsg && (
                                                        <p
                                                            className="pl-7 pr-1 text-xs text-destructive flex items-start gap-1"
                                                            title={failureMsg}
                                                        >
                                                            <X className="size-3 shrink-0 mt-0.5" />
                                                            <span className="line-clamp-2 break-all">{failureMsg}</span>
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        );
                    })}
                </Accordion>
            </div>
        </div>
    );
}

function SortSection({
    members,
    onReorder,
    onRemove,
    onWeightChange,
    removingIds,
    pendingKeys,
    showWeight,
    onClear,
    onTest,
    isTesting,
    onSort,
}: {
    members: SelectedMember[];
    onReorder: (members: SelectedMember[]) => void;
    onRemove: (id: string) => void;
    onWeightChange: (id: string, weight: number) => void;
    removingIds: Set<string>;
    pendingKeys: Set<string>;
    showWeight: boolean;
    onClear: () => void;
    onTest: () => void;
    isTesting: boolean;
    onSort: () => void;
}) {
    const t = useTranslations('group');

    return (
        <div className="rounded-xl border border-border/50 bg-muted/30 flex flex-col min-h-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 bg-muted/50">
                <span className="text-sm font-medium text-foreground">
                    {t('form.items')}
                    {members.length > 0 && (
                        <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                            ({members.length})
                        </span>
                    )}
                </span>
                <div className="flex items-center gap-1">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                onClick={onTest}
                                disabled={isTesting || members.length === 0}
                                className={cn(
                                    'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors',
                                    isTesting || members.length === 0
                                        ? 'text-muted-foreground/50 cursor-not-allowed'
                                        : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                                )}
                                title={members.length === 0 ? t('form.testConnectionNoMembers') : t('form.testConnection')}
                            >
                                {isTesting ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                    <Zap className="size-3.5" />
                                )}
                                <span>{t('form.testConnection')}</span>
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>{t('form.testConnection')}</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                onClick={onSort}
                                disabled={members.length === 0}
                                className={cn(
                                    'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors',
                                    members.length === 0
                                        ? 'text-muted-foreground/50 cursor-not-allowed'
                                        : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                                )}
                                title={t('form.sortByLatency')}
                            >
                                <ArrowUpDown className="size-3.5" />
                                <span>{t('form.sortByLatency')}</span>
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>{t('form.sortByLatency')}</TooltipContent>
                    </Tooltip>

                    <button
                        type="button"
                        onClick={onClear}
                        disabled={members.length === 0}
                        className={cn(
                            'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors',
                            members.length === 0
                                ? 'text-muted-foreground/50 cursor-not-allowed'
                                : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                        )}
                        title={t('form.clear')}
                    >
                        <Trash2 className="size-3.5" />
                        <span>{t('form.clear')}</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0">
                <MemberList
                    members={members}
                    onReorder={onReorder}
                    onRemove={onRemove}
                    onWeightChange={onWeightChange}
                    removingIds={removingIds}
                    pendingKeys={pendingKeys}
                    showWeight={showWeight}
                    showConfirmDelete={false}
                />
            </div>
        </div>
    );
}

export function GroupEditor({
    initial,
    submitText,
    submittingText,
    isSubmitting,
    groupId,
    onSubmit,
    onCancel,
}: {
    initial?: Partial<GroupEditorValues>;
    submitText: string;
    submittingText: string;
    isSubmitting: boolean;
    groupId?: number;
    onSubmit: (values: GroupEditorValues) => void;
    onCancel?: () => void;
}) {
    const t = useTranslations('group');
    const { data: modelChannels = [] } = useModelChannelList();

    const [groupName, setGroupName] = useState(initial?.name ?? '');
    const [matchRegex, setMatchRegex] = useState(initial?.match_regex ?? '');
    const [mode, setMode] = useState<GroupMode>((initial?.mode ?? 1) as GroupMode);
    const [firstTokenTimeOut, setFirstTokenTimeOut] = useState<number>(initial?.first_token_time_out ?? 0);
    const [sessionKeepTime, setSessionKeepTime] = useState<number>(initial?.session_keep_time ?? 0);
    const [selectedMembers, setSelectedMembers] = useState<SelectedMember[]>(initial?.members ?? []);
    const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
    const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
    const [failedMap, setFailedMap] = useState<Map<string, string>>(new Map());
const [expandedChannels, setExpandedChannels] = useState<Set<number>>(new Set());
    const validateMutation = useAddModelsWithValidation();
    const channelTestMutation = useChannelTestMutation();
    const [testingChannelId, setTestingChannelId] = useState<number | null>(null);
    const handleRemoveMember = useCallback((id: string) => {
        setRemovingIds((prev) => new Set(prev).add(id));
        setTimeout(() => {
            setSelectedMembers((prev) => prev.filter((m) => m.id !== id));
            setRemovingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
        }, 200);
    }, []);

    const groupKey = normalizeKey(groupName);
    const regexKey = matchRegex.trim();

    const { matchedModelChannels, regexError } = useMemo(() => {
        const parseRegex = (input: string): RegExp => {
            const inlineMatch = input.match(/^\(\?([ism]+)\)(.+)$/);
            if (inlineMatch) {
                const flagMap: Record<string, string> = { i: 'i', s: 's', m: 'm' };
                const flags = inlineMatch[1].split('').map(f => flagMap[f] || '').join('');
                return new RegExp(inlineMatch[2], flags);
            }

            return new RegExp(input);
        };

        if (regexKey) {
            try {
                const re = parseRegex(regexKey);
                return { matchedModelChannels: modelChannels.filter((mc) => re.test(mc.name)), regexError: '' };
            } catch (e) {
                return { matchedModelChannels: [], regexError: (e as Error)?.message ?? 'Invalid regex' };
            }
        }
        if (!groupKey) return { matchedModelChannels: [], regexError: '' };
        return { matchedModelChannels: modelChannels.filter((mc) => matchesGroupName(mc.name, groupKey)), regexError: '' };
    }, [groupKey, regexKey, modelChannels]);

    const sortMembersByLatency = useCallback((members: SelectedMember[]): SelectedMember[] => {
        return [...members].sort((a, b) => {
            const la = a.latency_ms ?? Number.MAX_VALUE;
            const lb = b.latency_ms ?? Number.MAX_VALUE;
            return la - lb;
        });
    }, []);

    const validateAndCommit = useCallback((channels: LLMChannel[]) => {
        if (channels.length === 0) return;
        const keys = channels.map(memberKey);
        setPendingKeys((prev) => {
            const next = new Set(prev);
            keys.forEach((k) => next.add(k));
            return next;
        });
        setFailedMap((prev) => {
            const next = new Map(prev);
            keys.forEach((k) => next.delete(k));
            return next;
        });

        const items = channels.map((m, idx) => ({
            channel_id: m.channel_id,
            model_name: m.name,
            priority: idx + 1,
            weight: 1,
        }));

        validateMutation.mutate(
            {
                group_id: groupId ?? 0,
                items_to_validate: items,
                validate_only: groupId === undefined,
                // 把"首字超时"作为本次验证的超时上限：用户期望验证行为与运行时一致。
                // 0 时后端回落到全局 SettingKeyModelValidationTimeout。
                timeout_seconds: firstTokenTimeOut,
            },
            {
                onSuccess: (resp) => {
                    const results = resp.results ?? [];
                    const failedKeys = new Set<string>();
                    const failedMessages = new Map<string, string>();
                    const passedByKey = new Map<string, number>();
                    results.forEach((r) => {
                        const k = `${r.channel_id}-${r.model_name}`;
                        if (r.passed) {
                            passedByKey.set(k, r.latency_ms);
                        } else {
                            failedKeys.add(k);
                            failedMessages.set(k, r.error || t('form.testFailed'));
                        }
                    });

                    setSelectedMembers((prev) => {
                        if (passedByKey.size === 0 && failedKeys.size === 0) return prev;

                        const existing = new Set(prev.map((m) => m.id));
                        const toAdd: SelectedMember[] = [];
                        // 失败的项保留在列表里（让用户能看到并手动删除），
                        // 但标上 validation_failed：创建提交时会自动过滤；
                        // 仍处于 pending 状态的项不覆盖。
                        const next = prev.map((m) => {
                            const isFailed = failedKeys.has(m.id);
                            const lat = passedByKey.get(m.id);
                            return {
                                ...m,
                                latency_ms: lat !== undefined ? lat : m.latency_ms,
                                validation_failed: isFailed ? true : (m.validation_failed ?? false),
                            };
                        });

                        passedByKey.forEach((lat, key) => {
                            if (existing.has(key)) return;
                            const ch = channels.find((c) => memberKey(c) === key);
                            if (ch) toAdd.push({ ...ch, id: key, weight: 1, latency_ms: lat });
                        });

                        if (toAdd.length === 0) return next;
                        return sortMembersByLatency([...next, ...toAdd]);
                    });
                    setFailedMap((prev) => {
                        const next = new Map(prev);
                        failedMessages.forEach((msg, k) => next.set(k, msg));
                        failedKeys.forEach((k) => {
                            if (!failedMessages.has(k)) next.set(k, t('form.testFailed'));
                        });
                        return next;
                    });
                },
                onError: (error) => {
                    keys.forEach((k) => setFailedMap((prev) => new Map(prev).set(k, error.message)));
                },
                onSettled: () => {
                    setPendingKeys((prev) => {
                        const next = new Set(prev);
                        keys.forEach((k) => next.delete(k));
                        return next;
                    });
                },
            },
        );
    }, [groupId, validateMutation, t, firstTokenTimeOut, sortMembersByLatency]);

    const handleAddMember = useCallback((channel: LLMChannel) => {
        const key = memberKey(channel);
        setSelectedMembers((prev) => {
            if (prev.some((m) => m.id === key)) return prev;
            return [...prev, { ...channel, id: key, weight: 1 }];
        });
        validateAndCommit([channel]);
    }, [validateAndCommit]);

    const autoAddDisabled = useMemo(() => {
        if ((!regexKey && !groupKey) || regexError || matchedModelChannels.length === 0) return true;
        const existing = new Set(selectedMembers.map((m) => m.id));
        return matchedModelChannels.every((mc) => existing.has(memberKey(mc)));
    }, [groupKey, regexKey, regexError, matchedModelChannels, selectedMembers]);

    const handleAutoAdd = useCallback(() => {
        if (matchedModelChannels.length === 0) return;
        const existing = new Set(selectedMembers.map((m) => m.id));
        const toAdd = matchedModelChannels.filter((mc) => !existing.has(memberKey(mc)));
        if (toAdd.length === 0) return;
        setSelectedMembers((prev) => {
            const ex = new Set(prev.map((m) => m.id));
            const additions = toAdd
                .filter((mc) => !ex.has(memberKey(mc)))
                .map((mc) => ({ ...mc, id: memberKey(mc), weight: 1 }));
            return additions.length ? [...prev, ...additions] : prev;
        });
        validateAndCommit(toAdd);
    }, [matchedModelChannels, selectedMembers, validateAndCommit]);

    const handleTest = useCallback(() => {
        if (selectedMembers.length === 0) return;
        const testingKeys = selectedMembers.map((m) => m.id);
        setPendingKeys((prev) => {
            const next = new Set(prev);
            testingKeys.forEach((k) => next.add(k));
            return next;
        });
        setFailedMap((prev) => {
            const next = new Map(prev);
            testingKeys.forEach((k) => next.delete(k));
            return next;
        });

        const itemsToTest = selectedMembers.map((m, idx) => ({
            channel_id: m.channel_id,
            model_name: m.name,
            priority: idx + 1,
            weight: m.weight ?? 1,
        }));

        validateMutation.mutate(
            {
                group_id: groupId ?? 0,
                items_to_validate: itemsToTest,
                validate_only: groupId === undefined,
                timeout_seconds: firstTokenTimeOut,
            },
            {
                onSuccess: (resp) => {
                    const results = resp.results ?? [];
                    const passedByKey = new Map<string, number>();
                    const failedKeys = new Set<string>();
                    const failedMessages = new Map<string, string>();

                    results.forEach((r) => {
                        const k = `${r.channel_id}-${r.model_name}`;
                        if (r.passed) {
                            passedByKey.set(k, r.latency_ms);
                        } else {
                            failedKeys.add(k);
                            failedMessages.set(k, r.error || t('form.testFailed'));
                        }
                    });

                    setSelectedMembers((prev) => {
                        const existing = new Set(prev.map((m) => m.id));
                        const toAdd: SelectedMember[] = [];
                        const next = prev.map((m) => {
                            const isFailed = failedKeys.has(m.id);
                            const lat = passedByKey.get(m.id);
                            return {
                                ...m,
                                latency_ms: lat !== undefined ? lat : m.latency_ms,
                                validation_failed: isFailed || (m.validation_failed ?? false),
                            };
                        });

                        passedByKey.forEach((lat, key) => {
                            if (existing.has(key)) return;
                            const ch = selectedMembers.find((c) => c.id === key);
                            if (ch) toAdd.push({ ...ch, id: key, weight: 1, latency_ms: lat });
                        });

                        if (toAdd.length === 0) return sortMembersByLatency(next);
                        return sortMembersByLatency([...next, ...toAdd]);
                    });

                    setFailedMap((prev) => {
                        const next = new Map(prev);
                        failedMessages.forEach((msg, k) => next.set(k, msg));
                        failedKeys.forEach((k) => {
                            if (!failedMessages.has(k)) next.set(k, t('form.testFailed'));
                        });
                        return next;
                    });

                    const passedCount = results.filter((r) => r.passed).length;
                    const total = results.length;
                    if (passedCount > 0) {
                        toast.success(t('form.testConnectionSuccess', { passed: passedCount, total }));
                    } else {
                        toast.error(t('form.testConnectionAllFailed'));
                    }
                },
                onError: (error) => {
                    testingKeys.forEach((k) => setFailedMap((prev) => new Map(prev).set(k, error.message)));
                },
                onSettled: () => {
                    setPendingKeys((prev) => {
                        const next = new Set(prev);
                        testingKeys.forEach((k) => next.delete(k));
                        return next;
                    });
                },
            },
        );
    }, [selectedMembers, groupId, validateMutation, t, firstTokenTimeOut, sortMembersByLatency]);

    const handleWeightChange = useCallback((id: string, weight: number) => {
        setSelectedMembers((prev) => prev.map((m) => m.id === id ? { ...m, weight } : m));
    }, []);

    const handleSort = useCallback(() => {
        setSelectedMembers((prev) => sortMembersByLatency(prev));
    }, [sortMembersByLatency]);

    const handleTestChannel = useCallback((channelId: number, models: LLMChannel[]) => {
        if (models.length === 0) return;
        setTestingChannelId(channelId);
        // Don't touch pendingKeys here — it would show spinners in the right panel.
        // We track testing state via testingChannelId instead.

        channelTestMutation.mutate(
            {
                channel_id: channelId,
                timeout_seconds: firstTokenTimeOut,
            },
            {
                onSuccess: (resp) => {
                    const results = resp.results ?? [];
                    const failedKeys = new Set<string>();
                    const failedMessages = new Map<string, string>();
                    const passedByKey = new Map<string, number>();

                    results.forEach((r) => {
                        const k = `${r.channel_id}-${r.model_name}`;
                        if (r.passed) {
                            passedByKey.set(k, r.latency_ms);
                        } else {
                            failedKeys.add(k);
                            failedMessages.set(k, r.error || t('form.testFailed'));
                        }
                    });

                    setSelectedMembers((prev) => {
                        const existing = new Set(prev.map((m) => m.id));
                        const toAdd: SelectedMember[] = [];
                        const next = prev.map((m) => {
                            const isFailed = failedKeys.has(m.id);
                            const lat = passedByKey.get(m.id);
                            return {
                                ...m,
                                latency_ms: lat !== undefined ? lat : m.latency_ms,
                                validation_failed: isFailed || (m.validation_failed ?? false),
                            };
                        });

                        passedByKey.forEach((lat, key) => {
                            if (existing.has(key)) return;
                            const ch = models.find((c) => memberKey(c) === key);
                            if (ch) toAdd.push({ ...ch, id: key, weight: 1, latency_ms: lat });
                        });

                        if (toAdd.length === 0) return next;
                        return [...next, ...toAdd];
                    });

                    setFailedMap((prev) => {
                        const next = new Map(prev);
                        failedMessages.forEach((msg, k) => next.set(k, msg));
                        failedKeys.forEach((k) => {
                            if (!failedMessages.has(k)) next.set(k, t('form.testFailed'));
                        });
                        return next;
                    });

                    const passedCount = results.filter((r) => r.passed).length;
                    const total = results.length;
                    if (passedCount > 0) {
                        toast.success(t('form.testConnectionSuccess', { passed: passedCount, total }));
                    } else {
                        toast.error(t('form.testConnectionAllFailed'));
                    }
                },
                onError: (error) => {
                    models.forEach((m) => setFailedMap((prev) => new Map(prev).set(memberKey(m), error.message)));
                },
                onSettled: () => {
                    setTestingChannelId(null);
                },
            },
        );
    }, [channelTestMutation, t, firstTokenTimeOut]);

    const handleBatchTest = useCallback((models: LLMChannel[]) => {
        if (models.length === 0) return;
        const testingKeys = models.map(memberKey);
        setPendingKeys((prev) => {
            const next = new Set(prev);
            testingKeys.forEach((k) => next.add(k));
            return next;
        });
        setFailedMap((prev) => {
            const next = new Map(prev);
            testingKeys.forEach((k) => next.delete(k));
            return next;
        });

        const itemsToTest = models.map((m, idx) => ({
            channel_id: m.channel_id,
            model_name: m.name,
            priority: idx + 1,
            weight: 1,
        }));

        validateMutation.mutate(
            {
                group_id: groupId ?? 0,
                items_to_validate: itemsToTest,
                validate_only: groupId === undefined,
                timeout_seconds: firstTokenTimeOut,
            },
            {
                onSuccess: (resp) => {
                    const results = resp.results ?? [];
                    const passedByKey = new Map<string, number>();
                    const failedKeys = new Set<string>();
                    const failedMessages = new Map<string, string>();

                    results.forEach((r) => {
                        const k = `${r.channel_id}-${r.model_name}`;
                        if (r.passed) {
                            passedByKey.set(k, r.latency_ms);
                        } else {
                            failedKeys.add(k);
                            failedMessages.set(k, r.error || t('form.testFailed'));
                        }
                    });

                    setSelectedMembers((prev) => {
                        const existing = new Set(prev.map((m) => m.id));
                        const toAdd: SelectedMember[] = [];
                        const next = prev.map((m) => {
                            const isFailed = failedKeys.has(m.id);
                            const lat = passedByKey.get(m.id);
                            return {
                                ...m,
                                latency_ms: lat !== undefined ? lat : m.latency_ms,
                                validation_failed: isFailed || (m.validation_failed ?? false),
                            };
                        });

                        passedByKey.forEach((lat, key) => {
                            if (existing.has(key)) return;
                            const ch = models.find((c) => memberKey(c) === key);
                            if (ch) toAdd.push({ ...ch, id: key, weight: 1, latency_ms: lat });
                        });

                        if (toAdd.length === 0) return next;
                        return [...next, ...toAdd];
                    });

                    setFailedMap((prev) => {
                        const next = new Map(prev);
                        failedMessages.forEach((msg, k) => next.set(k, msg));
                        failedKeys.forEach((k) => {
                            if (!failedMessages.has(k)) next.set(k, t('form.testFailed'));
                        });
                        return next;
                    });

                    const passedCount = results.filter((r) => r.passed).length;
                    const total = results.length;
                    if (passedCount > 0) {
                        toast.success(t('form.testConnectionSuccess', { passed: passedCount, total }));
                    } else {
                        toast.error(t('form.testConnectionAllFailed'));
                    }
                },
                onError: (error) => {
                    testingKeys.forEach((k) => setFailedMap((prev) => new Map(prev).set(k, error.message)));
                },
                onSettled: () => {
                    setPendingKeys((prev) => {
                        const next = new Set(prev);
                        testingKeys.forEach((k) => next.delete(k));
                        return next;
                    });
                },
            },
        );
    }, [groupId, validateMutation, t, firstTokenTimeOut]);

    const handleClearMembers = useCallback(() => {
        setSelectedMembers([]);
        setRemovingIds(new Set());
    }, []);

    const isValid = groupKey.length > 0 && selectedMembers.length > 0 && !regexError;

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!isValid) return;
        onSubmit({
            name: groupName,
            match_regex: regexKey,
            mode,
            first_token_time_out: firstTokenTimeOut,
            session_keep_time: sessionKeepTime,
            members: selectedMembers,
        });
    };


    return (
        <form onSubmit={handleSubmit} className="flex flex-col h-full min-h-0 ">
            <div className="flex-1 min-h-0 overflow-hidden pr-1">
                <FieldGroup className="gap-4 flex flex-col min-h-0 h-full">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <Field>
                            <FieldLabel htmlFor="group-name">{t('form.name')}</FieldLabel>
                            <Input
                                id="group-name"
                                value={groupName}
                                onChange={(e) => setGroupName(e.target.value)}
                                className="rounded-xl"
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="group-match-regex">{t('form.matchRegex')}</FieldLabel>
                            <Input
                                id="group-match-regex"
                                value={matchRegex}
                                onChange={(e) => setMatchRegex(e.target.value)}
                                className="rounded-xl"
                                placeholder={t('form.matchRegexPlaceholder')}
                            />
                            {regexError && (
                                <p className="mt-1 text-xs text-destructive">
                                    {t('form.matchRegexInvalid')}: {regexError}
                                </p>
                            )}
                        </Field>

                        <Field>
                            <FieldLabel htmlFor="group-first-token-time-out">
                                {t('form.firstTokenTimeOut')}
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <HelpCircle className="size-4 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {t('form.firstTokenTimeOutHint')}
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </FieldLabel>
                            <Input
                                id="group-first-token-time-out"
                                type="number"
                                inputMode="numeric"
                                min={0}
                                step={1}
                                value={String(firstTokenTimeOut)}
                                onChange={(e) => {
                                    const raw = e.target.value;
                                    if (raw.trim() === '') {
                                        setFirstTokenTimeOut(0);
                                        return;
                                    }
                                    const n = Number.parseInt(raw, 10);
                                    setFirstTokenTimeOut(Number.isFinite(n) && n > 0 ? n : 0);
                                }}
                                className="rounded-xl"
                            />
                        </Field>

                        <Field>
                            <FieldLabel htmlFor="group-session-keep-time">
                                {t('form.sessionKeepTime')}
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <HelpCircle className="size-4 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {t('form.sessionKeepTimeHint')}
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </FieldLabel>
                            <Input
                                id="group-session-keep-time"
                                type="number"
                                inputMode="numeric"
                                min={0}
                                step={1}
                                value={String(sessionKeepTime)}
                                onChange={(e) => {
                                    const raw = e.target.value;
                                    if (raw.trim() === '') {
                                        setSessionKeepTime(0);
                                        return;
                                    }
                                    const n = Number.parseInt(raw, 10);
                                    setSessionKeepTime(Number.isFinite(n) && n > 0 ? n : 0);
                                }}
                                className="rounded-xl"
                            />
                        </Field>
                    </div>

                    {/* Mode */}
                    <div className="flex gap-1">
                        {([1, 2, 3, 4] as const).map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setMode(m)}
                                className={cn(
                                    'flex-1 py-1 text-xs rounded-lg transition-colors',
                                    mode === m ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
                                )}
                            >
                                {t(`mode.${MODE_LABELS[m]}`)}
                            </button>
                        ))}
                    </div>

                    <div className="flex-1 min-h-0">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-0">
                            <ModelPickerSection
                                modelChannels={modelChannels}
                                selectedMembers={selectedMembers}
                                onAdd={handleAddMember}
                                onAutoAdd={handleAutoAdd}
                                autoAddDisabled={autoAddDisabled}
                                pendingKeys={pendingKeys}
                                failedMap={failedMap}
                                onBatchTest={handleBatchTest}
                                isBatchTesting={validateMutation.isPending}
                                onTestChannel={handleTestChannel}
                                testingChannelId={testingChannelId}
                            />
                            <SortSection
                                members={selectedMembers}
                                onReorder={setSelectedMembers}
                                onRemove={handleRemoveMember}
                                onWeightChange={handleWeightChange}
                                removingIds={removingIds}
                                pendingKeys={pendingKeys}
                                showWeight={mode === 4}
                                onClear={handleClearMembers}
                                onTest={handleTest}
                                isTesting={validateMutation.isPending}
                                onSort={handleSort}
                            />
                        </div>
                    </div>
                </FieldGroup>
            </div>

            <div className="pt-4 mt-auto shrink-0">
                <div className="flex gap-2">
                    {onCancel && (
                        <Button type="button" variant="secondary" className="flex-1 rounded-xl h-11" onClick={onCancel}>
                            {t('detail.actions.cancel')}
                        </Button>
                    )}
                    <Button
                        type="submit"
                        disabled={!isValid || isSubmitting}
                        className="flex-1 rounded-xl h-11"
                    >
                        {isSubmitting ? submittingText : submitText}
                    </Button>
                </div>
            </div>
        </form>
    );
}
