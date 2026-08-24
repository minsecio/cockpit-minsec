import React, { useState, useEffect, useCallback } from 'react';
import {
    Card, CardBody, CardHeader, CardTitle, Button, Switch, Alert, Label, Content,
    ContentVariants, DescriptionList, DescriptionListGroup, DescriptionListTerm,
    DescriptionListDescription, Modal, ModalHeader, ModalBody, ModalFooter,
    Form, FormGroup, Radio, Grid, GridItem, Stack, StackItem, Split, SplitItem,
    Title, List, ListItem, CodeBlock, CodeBlockCode, Spinner, Flex, FlexItem,
    ClipboardCopy, Divider, ExpandableSection,
} from '@patternfly/react-core';
import {
    UsersIcon, CheckCircleIcon, ExclamationTriangleIcon, CubesIcon,
    LockIcon, ShareAltIcon, DownloadIcon,
} from '@patternfly/react-icons';
import cockpit from 'cockpit';

import * as minsec from './minsec.js';
import { Loading, Failure, Empty, StatTile } from './common.jsx';
import { FieldHelp } from './help.jsx';
import { relativeTime, tomlString } from './util.js';

const _ = cockpit.gettext;

const TIMER = 'minsec-sync.timer';

/* sync.toml is flat: no tables, no drop-ins. A line parser is sufficient. */
function parseSyncConfig(text) {
    const cfg = {};
    for (const raw of (text || '').split('\n')) {
        const line = raw.replace(/#.*$/, '').trim();
        const eq = line.indexOf('=');
        if (eq < 1)
            continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (value === 'true' || value === 'false')
            cfg[key] = value === 'true';
        else
            cfg[key] = value.replace(/^["']|["']$/g, '');
    }
    return cfg;
}

function buildSyncConfig(cfg) {
    return [
        '# minsec multiplayer. The existence of this file is the opt-in switch.',
        '# See minsec-sync.toml(5). Remove it to opt out completely.',
        '',
        `tier = ${tomlString(cfg.tier || 'basic')}`,
        `report = ${cfg.report !== false}`,
        `pull = ${cfg.pull !== false}`,
        `ipv4 = ${cfg.ipv4 !== false}`,
        `ipv6 = ${cfg.ipv6 !== false}`,
        ...cfg.server ? [`server = ${tomlString(cfg.server)}`] : [],
        '',
    ].join('\n');
}

function PrivacyPanel() {
    return (
        <Grid hasGutter>
            <GridItem span={12} md={6}>
                <Card isPlain isCompact>
                    <CardHeader>
                        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                            <FlexItem><ShareAltIcon /></FlexItem>
                            <FlexItem><CardTitle>{_("What leaves this machine")}</CardTitle></FlexItem>
                        </Flex>
                    </CardHeader>
                    <CardBody>
                        <List>
                            <ListItem>{_("The attacker's network, shortened to /24 for IPv4 and /64 for IPv6.")}</ListItem>
                            <ListItem>{_("When it happened, which filter caught it, how many failures, and how long you banned it.")}</ListItem>
                        </List>
                    </CardBody>
                </Card>
            </GridItem>
            <GridItem span={12} md={6}>
                <Card isPlain isCompact>
                    <CardHeader>
                        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                            <FlexItem><LockIcon /></FlexItem>
                            <FlexItem><CardTitle>{_("What never does")}</CardTitle></FlexItem>
                        </Flex>
                    </CardHeader>
                    <CardBody>
                        <List>
                            <ListItem>{_("Log lines, in any form.")}</ListItem>
                            <ListItem>{_("Usernames, attempted or local.")}</ListItem>
                            <ListItem>{_("Anything about this machine's users, services or configuration.")}</ListItem>
                            <ListItem>{_("Bans you added by hand — those stay local.")}</ListItem>
                        </List>
                    </CardBody>
                </Card>
            </GridItem>
        </Grid>
    );
}

function OptInDialog({ isOpen, onClose, onDone }) {
    const [tier, setTier] = useState('basic');
    const [busy, setBusy] = useState(false);
    const [log, setLog] = useState('');
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isOpen) {
            setTier('basic'); setBusy(false); setLog(''); setError(null);
        }
    }, [isOpen]);

    const turnOn = async () => {
        setBusy(true);
        setError(null);
        setLog('');
        try {
            await minsec.writeSyncConfig(buildSyncConfig({ tier }));
            setLog(_("Configuration written. Enrolling with the server…"));
            // Enrolling reaches the network and solves a proof-of-work
            // challenge, so it can take a few seconds.
            const out = await minsec.syncRun('enroll');
            setLog(l => l + '\n' + out.trim());
            await minsec.unitAction(TIMER, 'enable');
            await minsec.unitAction(TIMER, 'start');
            setLog(l => l + '\n' + _("Scheduled updates every five minutes."));
            onDone();
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} variant="medium">
            <ModalHeader title={_("Turn on multiplayer")} />
            <ModalBody>
                <Stack hasGutter>
                    <StackItem>
                        <Content component={ContentVariants.p}>
                            {_("This machine will start sharing the networks that attack it, and will block networks that have already attacked other minsec users.")}
                        </Content>
                    </StackItem>
                    <StackItem><PrivacyPanel /></StackItem>
                    <StackItem>
                        <Form>
                            <FormGroup role="radiogroup" fieldId="tier" label={_("Blocklist")}
                                       labelHelp={<FieldHelp name="tier" />}>
                                <Radio id="tier-basic" name="tier" label={_("Basic")}
                                       description={_("The standard crowd blocklist.")}
                                       isChecked={tier === 'basic'} onChange={() => setTier('basic')} />
                                <Radio id="tier-high" name="tier" label={_("High confidence")}
                                       description={_("Stricter: fewer networks, each with stronger corroboration.")}
                                       isChecked={tier === 'high'} onChange={() => setTier('high')} />
                            </FormGroup>
                        </Form>
                    </StackItem>
                    <StackItem>
                        <Alert variant="info" isInline isPlain title={_("Turning it on contacts the minsec server")}>
                            {_("A signing key is created on this machine and used to enroll it. The key is what identifies this host; no account or personal details are involved. You can turn this off again at any time.")}
                        </Alert>
                    </StackItem>
                    {error && <StackItem><Alert variant="danger" isInline title={_("Could not turn on multiplayer")}>{error}</Alert></StackItem>}
                    {log &&
                        <StackItem>
                            <CodeBlock><CodeBlockCode>{log}</CodeBlockCode></CodeBlock>
                        </StackItem>}
                </Stack>
            </ModalBody>
            <ModalFooter>
                <Button variant="primary" onClick={turnOn} isDisabled={busy} isLoading={busy}>
                    {busy ? _("Enrolling…") : _("Turn on and enroll")}
                </Button>
                <Button variant="link" onClick={onClose} isDisabled={busy}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
}

function OptOutDialog({ isOpen, onClose, onDone }) {
    const [flush, setFlush] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const turnOff = async () => {
        setBusy(true);
        setError(null);
        try {
            await minsec.unitAction(TIMER, 'stop').catch(() => {});
            await minsec.unitAction(TIMER, 'disable').catch(() => {});
            await minsec.removeSyncConfig();
            if (flush) {
                // Disabling stops updates but leaves the sets populated.
                for (const set of ['crowd4', 'crowd6']) {
                    await cockpit.spawn(['nft', 'flush', 'set', 'inet', 'minsec', set],
                                        { superuser: 'require', err: 'message' }).catch(() => {});
                }
            }
            onDone();
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} variant="small">
            <ModalHeader title={_("Turn off multiplayer")} titleIconVariant="warning" />
            <ModalBody>
                <Stack hasGutter>
                    <StackItem>
                        <Content component={ContentVariants.p}>
                            {_("This machine will stop sharing attacker networks and stop receiving the crowd blocklist. Your own filters and bans are unaffected.")}
                        </Content>
                    </StackItem>
                    <StackItem>
                        <Switch id="flush-sets" isChecked={flush} onChange={(_e, v) => setFlush(v)}
                                label={_("Also remove the downloaded blocklist entries")} />
                        <Content component={ContentVariants.small}>
                            {_("Otherwise the networks already downloaded stay blocked until you remove them.")}
                        </Content>
                    </StackItem>
                    {error && <StackItem><Alert variant="danger" isInline title={error} /></StackItem>}
                </Stack>
            </ModalBody>
            <ModalFooter>
                <Button variant="danger" onClick={turnOff} isDisabled={busy} isLoading={busy}>
                    {_("Turn off")}
                </Button>
                <Button variant="link" onClick={onClose} isDisabled={busy}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
}

export default function Multiplayer({ ctx }) {
    const [state, setState] = useState({ loading: true });
    const [optIn, setOptIn] = useState(false);
    const [optOut, setOptOut] = useState(false);
    const [busy, setBusy] = useState(false);
    const [runLog, setRunLog] = useState(null);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        try {
            const installed = await minsec.syncInstalled();
            if (!installed) {
                setState({ loading: false, installed: false });
                return;
            }
            const [configText, syncState, timer, crowd] = await Promise.all([
                minsec.syncConfig().catch(() => null),
                minsec.syncState(),
                minsec.unitState(TIMER),
                minsec.crowdSetSizes().catch(() => ({ crowd4: null, crowd6: null })),
            ]);
            setState({
                loading: false,
                installed: true,
                enabled: configText !== null,
                config: parseSyncConfig(configText),
                syncState,
                timer,
                crowd,
            });
        } catch (err) {
            setState({ loading: false, error: err });
        }
    }, []);

    useEffect(() => { load() }, [load, ctx.reloadKey]);

    const setOption = useCallback(async (key, value) => {
        setBusy(true);
        setError(null);
        try {
            await minsec.writeSyncConfig(buildSyncConfig({ ...state.config, [key]: value }));
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }, [state.config, load]);

    const runNow = useCallback(async () => {
        setBusy(true);
        setError(null);
        setRunLog(null);
        try {
            const out = await minsec.syncRun('run');
            setRunLog(out.trim() || _("Nothing new to report, and the blocklist is already up to date."));
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }, [load]);

    if (state.loading)
        return <Loading />;
    if (state.error)
        return <Failure error={state.error} onRetry={load} />;

    if (!state.installed) {
        return (
            <Card>
                <CardBody>
                    <Empty icon={CubesIcon} title={_("The multiplayer helper is not installed")}
                           body={_("Multiplayer needs the minsec-sync program, which is packaged separately so that the daemon itself carries no network code. Install it to share attacker networks and receive the crowd blocklist.")} />
                    <Divider className="pf-v6-u-my-md" />
                    <PrivacyPanel />
                </CardBody>
            </Card>
        );
    }

    if (!state.enabled) {
        return (
            <>
                <Card>
                    <CardBody>
                        <Stack hasGutter>
                            <StackItem>
                                <Split hasGutter>
                                    <SplitItem isFilled>
                                        <Flex spaceItems={{ default: 'spaceItemsSm' }}
                                              alignItems={{ default: 'alignItemsCenter' }}>
                                            <FlexItem><UsersIcon /></FlexItem>
                                            <FlexItem>
                                                <Title headingLevel="h2" size="lg">{_("Multiplayer is off")}</Title>
                                            </FlexItem>
                                        </Flex>
                                        <Content component={ContentVariants.p}>
                                            {_("Every minsec installation sees the same attackers eventually. Multiplayer shares what this machine has seen and blocks what others have already seen, so an attacker that hits one server is blocked on yours before it arrives.")}
                                        </Content>
                                    </SplitItem>
                                    <SplitItem>
                                        <Button variant="primary" onClick={() => setOptIn(true)}
                                                isDisabled={ctx.admin === false}>
                                            {_("Turn on multiplayer")}
                                        </Button>
                                    </SplitItem>
                                </Split>
                            </StackItem>
                            <StackItem><Divider /></StackItem>
                            <StackItem><PrivacyPanel /></StackItem>
                            <StackItem>
                                <Button variant="link" isInline onClick={() => ctx.openHelp('multiplayer')}>
                                    {_("Read more about how this works and what it sends")}
                                </Button>
                            </StackItem>
                        </Stack>
                    </CardBody>
                </Card>
                <OptInDialog isOpen={optIn} onClose={() => setOptIn(false)} onDone={load} />
            </>
        );
    }

    const { config, syncState, timer, crowd } = state;
    const enrolled = !!syncState?.host_id;
    const crowdTotal = (crowd.crowd4 ?? 0) + (crowd.crowd6 ?? 0);

    return (
        <Stack hasGutter>
            <StackItem>
                <Card>
                    <CardBody>
                        <Split hasGutter>
                            <SplitItem isFilled>
                                <Flex spaceItems={{ default: 'spaceItemsSm' }}
                                      alignItems={{ default: 'alignItemsCenter' }}>
                                    <FlexItem><UsersIcon /></FlexItem>
                                    <FlexItem><Title headingLevel="h2" size="lg">{_("Multiplayer")}</Title></FlexItem>
                                    <FlexItem>
                                        {enrolled
                                            ? <Label color="green" icon={<CheckCircleIcon />}>{_("Enrolled")}</Label>
                                            : <Label color="orange" icon={<ExclamationTriangleIcon />}>
                                                {_("Not enrolled yet")}
                                            </Label>}
                                    </FlexItem>
                                    {!timer.active &&
                                        <FlexItem>
                                            <Label color="orange">{_("Scheduled updates are off")}</Label>
                                        </FlexItem>}
                                </Flex>
                            </SplitItem>
                            <SplitItem>
                                <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                                    <FlexItem>
                                        <Button variant="secondary" onClick={runNow} isDisabled={busy}>
                                            {_("Sync now")}
                                        </Button>
                                    </FlexItem>
                                    <FlexItem>
                                        <Button variant="link" onClick={() => setOptOut(true)}
                                                isDisabled={ctx.admin === false}>
                                            {_("Turn off")}
                                        </Button>
                                    </FlexItem>
                                </Flex>
                            </SplitItem>
                        </Split>
                    </CardBody>
                </Card>
            </StackItem>

            {error && <StackItem><Alert variant="danger" isInline title={error} /></StackItem>}

            {!timer.active &&
                <StackItem>
                    <Alert variant="warning" isInline title={_("Updates are not running on a schedule")}
                           actionLinks={
                               <Button variant="link" isInline isDisabled={busy}
                                       onClick={async () => {
                                           setBusy(true);
                                           await minsec.unitAction(TIMER, 'enable').catch(() => {});
                                           await minsec.unitAction(TIMER, 'start').catch(() => {});
                                           setBusy(false);
                                           load();
                                       }}>
                                   {_("Start scheduled updates")}
                               </Button>
                           }>
                        {_("Multiplayer is configured, but the timer that reports bans and refreshes the blocklist every five minutes is not running.")}
                    </Alert>
                </StackItem>}

            {runLog &&
                <StackItem>
                    <Alert variant="info" isInline title={_("Sync finished")}
                           actionClose={<Button variant="plain" onClick={() => setRunLog(null)}>×</Button>}>
                        <CodeBlock><CodeBlockCode>{runLog}</CodeBlockCode></CodeBlock>
                    </Alert>
                </StackItem>}

            <StackItem>
                <Grid hasGutter>
                    <GridItem span={12} md={4}>
                        <Card isFullHeight>
                            <CardHeader><CardTitle>{_("Blocklist received")}</CardTitle></CardHeader>
                            <CardBody>
                                {crowdTotal === 0
                                    ? <Content component={ContentVariants.small}>
                                        {_("No entries yet. The first update runs within a few minutes.")}
                                    </Content>
                                    : <Grid hasGutter>
                                        <GridItem span={6}>
                                            <StatTile label={_("IPv4")} value={crowd.crowd4 ?? '—'}
                                                      description={_("networks blocked")} />
                                        </GridItem>
                                        <GridItem span={6}>
                                            <StatTile label={_("IPv6")} value={crowd.crowd6 ?? '—'}
                                                      description={_("networks blocked")} />
                                        </GridItem>
                                    </Grid>}
                            </CardBody>
                        </Card>
                    </GridItem>

                    <GridItem span={12} md={8}>
                        <Card isFullHeight>
                            <CardHeader><CardTitle>{_("What this machine does")}</CardTitle></CardHeader>
                            <CardBody>
                                <Form isHorizontal>
                                    <FormGroup fieldId="report" label={_("Share attacks with others")}>
                                        <Switch id="report" isChecked={config.report !== false}
                                                isDisabled={busy || ctx.admin === false}
                                                aria-label={_("Share attacks with others")}
                                                onChange={(_e, v) => setOption('report', v)} />
                                    </FormGroup>
                                    <FormGroup fieldId="pull" label={_("Receive the crowd blocklist")}>
                                        <Switch id="pull" isChecked={config.pull !== false}
                                                isDisabled={busy || ctx.admin === false}
                                                aria-label={_("Receive the crowd blocklist")}
                                                onChange={(_e, v) => setOption('pull', v)} />
                                    </FormGroup>
                                    <FormGroup role="radiogroup" fieldId="tier2" label={_("Blocklist")}
                                               labelHelp={<FieldHelp name="tier" />}>
                                        <Radio id="tier2-basic" name="tier2" label={_("Basic")}
                                               isDisabled={busy || ctx.admin === false}
                                               isChecked={(config.tier || 'basic') === 'basic'}
                                               onChange={() => setOption('tier', 'basic')} />
                                        <Radio id="tier2-high" name="tier2" label={_("High confidence")}
                                               isDisabled={busy || ctx.admin === false}
                                               isChecked={config.tier === 'high'}
                                               onChange={() => setOption('tier', 'high')} />
                                    </FormGroup>
                                </Form>
                            </CardBody>
                        </Card>
                    </GridItem>
                </Grid>
            </StackItem>

            <StackItem>
                <ExpandableSection toggleText={_("Enrollment details")}>
                    <Card>
                        <CardBody>
                            <DescriptionList isHorizontal>
                                <DescriptionListGroup>
                                    <DescriptionListTerm>{_("Server")}</DescriptionListTerm>
                                    <DescriptionListDescription>
                                        <code>{config.server || 'https://api.minsec.io'}</code>
                                    </DescriptionListDescription>
                                </DescriptionListGroup>
                                <DescriptionListGroup>
                                    <DescriptionListTerm>{_("Host ID")}</DescriptionListTerm>
                                    <DescriptionListDescription>
                                        {syncState?.host_id
                                            ? <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")}
                                                             variant="inline-compact">
                                                {syncState.host_id}
                                            </ClipboardCopy>
                                            : _("Not enrolled")}
                                    </DescriptionListDescription>
                                </DescriptionListGroup>
                                <DescriptionListGroup>
                                    <DescriptionListTerm>{_("Reports submitted")}</DescriptionListTerm>
                                    <DescriptionListDescription>
                                        {syncState?.next_seq ? syncState.next_seq - 1 : 0}
                                    </DescriptionListDescription>
                                </DescriptionListGroup>
                                <DescriptionListGroup>
                                    <DescriptionListTerm>{_("Signing key")}</DescriptionListTerm>
                                    <DescriptionListDescription>
                                        <code>/var/lib/minsec/sync/key</code>
                                        <Content component={ContentVariants.small}>
                                            {_("Created on this machine and never transmitted. Preserve it across upgrades.")}
                                        </Content>
                                    </DescriptionListDescription>
                                </DescriptionListGroup>
                            </DescriptionList>
                        </CardBody>
                    </Card>
                </ExpandableSection>
            </StackItem>

            <StackItem>
                <Button variant="link" isInline onClick={() => ctx.openHelp('multiplayer')}>
                    {_("What is shared, and what never is")}
                </Button>
            </StackItem>

            <OptOutDialog isOpen={optOut} onClose={() => setOptOut(false)} onDone={load} />
        </Stack>
    );
}
