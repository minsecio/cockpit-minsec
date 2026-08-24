import React, { useState, useEffect, useCallback } from 'react';
import {
    Card, CardTitle, CardBody, CardHeader, Grid, GridItem, Flex, FlexItem,
    Button, Label, Content, ContentVariants, DescriptionList, DescriptionListGroup,
    DescriptionListTerm, DescriptionListDescription, Alert, Spinner, Divider,
    Stack, StackItem, Split, SplitItem,
} from '@patternfly/react-core';
import {
    CheckCircleIcon, ExclamationTriangleIcon, BanIcon, ShieldAltIcon,
    UsersIcon, OutlinedQuestionCircleIcon,
} from '@patternfly/react-icons';
import cockpit from 'cockpit';

import * as minsec from './minsec.js';
import { Loading, Failure, StatTile, Empty } from './common.jsx';
import { formatDuration, humanDuration, relativeTime } from './util.js';

const _ = cockpit.gettext;

function ServiceCard({ unit, onAction, busy, error }) {
    const running = unit?.active;
    return (
        <Card>
            <CardHeader>
                <Split hasGutter style={{ width: '100%' }}>
                    <SplitItem isFilled>
                        <CardTitle>{_("Service")}</CardTitle>
                    </SplitItem>
                    <SplitItem>
                        {running
                            ? <Label color="green" icon={<CheckCircleIcon />}>{_("Running")}</Label>
                            : <Label color="red" icon={<ExclamationTriangleIcon />}>
                                {unit?.exists ? _("Stopped") : _("Not installed")}
                            </Label>}
                    </SplitItem>
                </Split>
            </CardHeader>
            <CardBody>
                <Stack hasGutter>
                    {error && <StackItem><Alert variant="danger" isInline title={error} /></StackItem>}
                    <StackItem>
                        <DescriptionList isHorizontal isCompact>
                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("Start at boot")}</DescriptionListTerm>
                                <DescriptionListDescription>
                                    {unit?.enabled ? _("Enabled") : _("Disabled")}
                                </DescriptionListDescription>
                            </DescriptionListGroup>
                        </DescriptionList>
                    </StackItem>
                    <StackItem>
                        <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                            <FlexItem>
                                <Button variant={running ? 'secondary' : 'primary'} isDisabled={busy || !unit?.exists}
                                        onClick={() => onAction(running ? 'stop' : 'start')}>
                                    {running ? _("Stop") : _("Start")}
                                </Button>
                            </FlexItem>
                            <FlexItem>
                                <Button variant="secondary" isDisabled={busy || !running}
                                        onClick={() => onAction('restart')}>{_("Restart")}</Button>
                            </FlexItem>
                            <FlexItem>
                                <Button variant="link" isDisabled={busy || !unit?.exists}
                                        onClick={() => onAction(unit?.enabled ? 'disable' : 'enable')}>
                                    {unit?.enabled ? _("Do not start at boot") : _("Start at boot")}
                                </Button>
                            </FlexItem>
                            {busy && <FlexItem><Spinner size="md" /></FlexItem>}
                        </Flex>
                    </StackItem>
                </Stack>
            </CardBody>
        </Card>
    );
}

export default function Overview({ ctx }) {
    const [state, setState] = useState({ loading: true });
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState(null);

    const load = useCallback(async () => {
        try {
            const unit = await minsec.unitState('minsec.service');

            /*
             * A stopped daemon is an ordinary state: the page still shows the
             * service card, filters and history. A missing package or refused
             * privileges is not, and must not be papered over with an empty
             * dashboard, so those errors are kept and reported.
             */
            let fatal = null;
            const soft = (promise, fallback) => promise.catch(err => {
                if (err.kind === 'missing' || err.kind === 'denied')
                    fatal = fatal || err;
                return fallback;
            });

            const [status, bans, events, syncOn] = await Promise.all([
                unit.active ? soft(minsec.status(), null) : Promise.resolve(null),
                unit.active ? soft(minsec.listBans(), []) : Promise.resolve([]),
                soft(minsec.events(8), []),
                soft(minsec.syncConfig().then(c => c !== null), false),
            ]);

            if (fatal)
                setState({ loading: false, error: fatal });
            else
                setState({ loading: false, unit, status, bans, events, syncOn });
        } catch (err) {
            setState({ loading: false, error: err });
        }
    }, []);

    useEffect(() => { load() }, [load, ctx.reloadKey]);

    // The counters are live; refresh them while the page is open.
    useEffect(() => {
        const t = setInterval(load, 10000);
        return () => clearInterval(t);
    }, [load]);

    const action = useCallback(async verb => {
        setBusy(true);
        setActionError(null);
        try {
            await minsec.unitAction('minsec.service', verb);
            await load();
        } catch (err) {
            setActionError(err.message);
        } finally {
            setBusy(false);
        }
    }, [load]);

    if (state.loading)
        return <Loading />;
    if (state.error)
        return <Failure error={state.error} onRetry={load} />;

    const { unit, status, bans, events, syncOn } = state;
    const enabledFilters = status?.filters || [];
    const matchedTotal = enabledFilters.reduce((n, f) => n + (f.matched || 0), 0);

    return (
        <Grid hasGutter>
            <GridItem span={12} md={6} lg={4}>
                <ServiceCard unit={unit} onAction={action} busy={busy} error={actionError} />
            </GridItem>

            <GridItem span={12} md={6} lg={8}>
                <Card isFullHeight>
                    <CardHeader>
                        <CardTitle>{_("Activity")}</CardTitle>
                    </CardHeader>
                    <CardBody>
                        {status
                            ? <Grid hasGutter>
                                <GridItem span={6} md={3}>
                                    <StatTile label={_("Active bans")} value={status.active_bans}
                                              description={_("blocked right now")} />
                                </GridItem>
                                <GridItem span={6} md={3}>
                                    <StatTile label={_("Bans issued")} value={status.bans_total}
                                              description={_("since the service started")} />
                                </GridItem>
                                <GridItem span={6} md={3}>
                                    <StatTile label={_("Failures matched")} value={matchedTotal}
                                              description={_("log lines that counted")} />
                                </GridItem>
                                <GridItem span={6} md={3}>
                                    <StatTile label={_("Networks watched")} value={status.tracked}
                                              description={_("with recent failures")} />
                                </GridItem>
                            </Grid>
                            : <Empty title={_("No live statistics")}
                                     body={_("Counters come from the running daemon. Start the service to see them.")} />}
                    </CardBody>
                    {status &&
                        <>
                            <Divider />
                            <CardBody>
                                <DescriptionList isHorizontal isCompact isFluid>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>{_("Version")}</DescriptionListTerm>
                                        <DescriptionListDescription>{status.version}</DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>{_("Firewall backend")}</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            <Flex spaceItems={{ default: 'spaceItemsXs' }}
                                                  alignItems={{ default: 'alignItemsCenter' }}>
                                                <FlexItem>
                                                    {status.backend === 'nft'
                                                        ? _("nftables")
                                                        : status.backend === 'null'
                                                            ? _("Observe only — nothing is blocked")
                                                            : _("Custom command")}
                                                </FlexItem>
                                                <FlexItem>
                                                    <Button variant="plain" isInline
                                                            aria-label={_("About firewall backends")}
                                                            onClick={() => ctx.openHelp('backends')}>
                                                        <OutlinedQuestionCircleIcon />
                                                    </Button>
                                                </FlexItem>
                                            </Flex>
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>{_("Running for")}</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            {humanDuration(status.uptime)}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                </DescriptionList>
                            </CardBody>
                        </>}
                </Card>
            </GridItem>

            {status && status.backend === 'null' &&
                <GridItem span={12}>
                    <Alert variant="warning" isInline title={_("Nothing is being blocked")}>
                        {_("The backend is set to observe only, so minsec records what it would have done without changing the firewall. Switch it to nftables in Settings once you are satisfied with the filters.")}
                    </Alert>
                </GridItem>}

            {status && enabledFilters.length === 0 &&
                <GridItem span={12}>
                    <Alert variant="warning" isInline title={_("No filters are enabled")}
                           actionLinks={<Button variant="link" isInline
                                                onClick={() => cockpit.location.go(['filters'])}>
                               {_("Choose filters")}
                           </Button>}>
                        {_("minsec is running but watching nothing. Enable a filter for each service you want protected.")}
                    </Alert>
                </GridItem>}

            <GridItem span={12} lg={6}>
                <Card isFullHeight>
                    <CardHeader actions={{
                        actions: <Button variant="secondary"
                                         onClick={() => cockpit.location.go(['filters'])}>{_("Manage")}</Button>
                    }}>
                        <CardTitle>{_("Enabled filters")}</CardTitle>
                    </CardHeader>
                    <CardBody>
                        {enabledFilters.length === 0
                            ? <Empty icon={ShieldAltIcon} title={_("Nothing is being watched")}
                                     body={_("Enable a filter to start watching a service's logs for abuse.")}
                                     action={<Button variant="primary"
                                                     onClick={() => cockpit.location.go(['filters'])}>
                                         {_("Choose filters")}
                                     </Button>} />
                            : <DescriptionList isCompact>
                                {enabledFilters.map(f => (
                                    <DescriptionListGroup key={f.name}>
                                        <DescriptionListTerm>{f.name}</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            {cockpit.format(
                                                _("$0 failures, $1 bans — $2 tries in $3, then blocked for $4"),
                                                f.matched, f.banned, f.maxretry,
                                                humanDuration(f.findtime), humanDuration(f.bantime))}
                                            {f.journal &&
                                                <> · <Label isCompact variant="outline">{_("journal")}</Label></>}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                ))}
                            </DescriptionList>}
                    </CardBody>
                </Card>
            </GridItem>

            <GridItem span={12} lg={6}>
                <Card isFullHeight>
                    <CardHeader actions={{
                        actions: <Button variant="secondary"
                                         onClick={() => cockpit.location.go(['events'])}>{_("All events")}</Button>
                    }}>
                        <CardTitle>{_("Recent activity")}</CardTitle>
                    </CardHeader>
                    <CardBody>
                        {events.length === 0
                            ? <Empty icon={BanIcon} title={_("Nothing has happened yet")}
                                     body={_("Bans and service restarts will appear here.")} />
                            : <DescriptionList isCompact>
                                {events.map((e, i) => (
                                    <DescriptionListGroup key={i}>
                                        <DescriptionListTerm>{relativeTime(e.ts)}</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            {e.kind === 'ban' &&
                                                cockpit.format(_("Banned $0 — $1, $2 failures, for $3"),
                                                               e.net, e.filter, e.hits, formatDuration(e.ttl))}
                                            {e.kind === 'unban' &&
                                                cockpit.format(e.manual ? _("Unbanned $0 manually")
                                                    : _("Ban expired for $0"), e.net)}
                                            {e.kind === 'start' && cockpit.format(_("Service started (v$0)"), e.version)}
                                            {e.kind === 'stop' && _("Service stopped")}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                ))}
                            </DescriptionList>}
                    </CardBody>
                </Card>
            </GridItem>

            <GridItem span={12}>
                <Card>
                    <CardBody>
                        <Split hasGutter>
                            <SplitItem isFilled>
                                <Flex spaceItems={{ default: 'spaceItemsSm' }}
                                      alignItems={{ default: 'alignItemsCenter' }}>
                                    <FlexItem><UsersIcon /></FlexItem>
                                    <FlexItem>
                                        <Content component={ContentVariants.h3}>{_("Multiplayer")}</Content>
                                    </FlexItem>
                                    <FlexItem>
                                        {syncOn
                                            ? <Label color="green" isCompact>{_("On")}</Label>
                                            : <Label isCompact variant="outline">{_("Off")}</Label>}
                                    </FlexItem>
                                </Flex>
                                <Content component={ContentVariants.small}>
                                    {syncOn
                                        ? _("Sharing attacker networks with other minsec users and blocking what they have already seen.")
                                        : _("Block networks that have already attacked other minsec users, before they reach you. No log text or usernames ever leave this machine.")}
                                </Content>
                            </SplitItem>
                            <SplitItem>
                                <Button variant={syncOn ? 'secondary' : 'primary'}
                                        onClick={() => cockpit.location.go(['multiplayer'])}>
                                    {syncOn ? _("Manage") : _("Learn more")}
                                </Button>
                            </SplitItem>
                        </Split>
                    </CardBody>
                </Card>
            </GridItem>
        </Grid>
    );
}
