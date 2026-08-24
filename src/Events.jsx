import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Card, CardBody, Toolbar, ToolbarContent, ToolbarItem, SearchInput, Button,
    Label, Content, ContentVariants, Title, Split, SplitItem, ToggleGroup,
    ToggleGroupItem, Tooltip,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { HistoryIcon } from '@patternfly/react-icons';
import cockpit from 'cockpit';

import * as minsec from './minsec.js';
import { Loading, Failure, Empty } from './common.jsx';
import { formatDuration, formatTimestamp, relativeTime } from './util.js';

const _ = cockpit.gettext;

const KINDS = [
    { key: 'all', label: () => _("All") },
    { key: 'ban', label: () => _("Bans") },
    { key: 'unban', label: () => _("Unbans") },
    { key: 'service', label: () => _("Service") },
];

function describe(e) {
    switch (e.kind) {
    case 'ban':
        return e.manual
            ? cockpit.format(_("Blocked by an administrator for $0"), formatDuration(e.ttl))
            : cockpit.format(
                cockpit.ngettext("$0 failure caught by the $1 filter; blocked for $2",
                                 "$0 failures caught by the $1 filter; blocked for $2", e.hits),
                e.hits, e.filter, formatDuration(e.ttl));
    case 'unban':
        return e.manual ? _("Unblocked by an administrator") : _("The ban expired");
    case 'start':
        return cockpit.format(_("The minsec service started, version $0"), e.version);
    case 'stop':
        return _("The minsec service stopped");
    default:
        return e.kind;
    }
}

function KindLabel({ event }) {
    switch (event.kind) {
    case 'ban':
        return <Label isCompact color={event.manual ? 'purple' : 'red'}>
            {event.manual ? _("Manual ban") : _("Ban")}
        </Label>;
    case 'unban':
        return <Label isCompact color="green" variant="outline">{_("Unban")}</Label>;
    case 'start':
        return <Label isCompact color="blue" variant="outline">{_("Started")}</Label>;
    case 'stop':
        return <Label isCompact variant="outline">{_("Stopped")}</Label>;
    default:
        return <Label isCompact variant="outline">{event.kind}</Label>;
    }
}

export default function Events({ ctx }) {
    const [state, setState] = useState({ loading: true });
    const [search, setSearch] = useState('');
    const [kind, setKind] = useState('all');
    const [limit, setLimit] = useState(200);

    const load = useCallback(async () => {
        try {
            const events = await minsec.events(limit);
            setState({ loading: false, events });
        } catch (err) {
            setState({ loading: false, error: err });
        }
    }, [limit]);

    useEffect(() => { load() }, [load, ctx.reloadKey]);

    const shown = useMemo(() => {
        let events = state.events || [];
        if (kind === 'service')
            events = events.filter(e => e.kind === 'start' || e.kind === 'stop');
        else if (kind !== 'all')
            events = events.filter(e => e.kind === kind);
        const q = search.trim().toLowerCase();
        if (q) {
            events = events.filter(e => (e.net || '').toLowerCase().includes(q) ||
                                        (e.filter || '').toLowerCase().includes(q));
        }
        return events;
    }, [state.events, kind, search]);

    if (state.loading)
        return <Loading />;
    if (state.error)
        return <Failure error={state.error} onRetry={load} />;

    return (
        <>
            <Card>
                <CardBody>
                    <Split hasGutter>
                        <SplitItem isFilled>
                            <Title headingLevel="h2" size="lg">{_("Event log")}</Title>
                            <Content component={ContentVariants.small}>
                                {_("Newest first. This log is what escalation and multiplayer reporting are built from. It never contains log text.")}
                                {' '}
                                <Button variant="link" isInline onClick={() => ctx.openHelp('events')}>
                                    {_("Learn more")}
                                </Button>
                            </Content>
                        </SplitItem>
                    </Split>
                </CardBody>
            </Card>

            <Card className="pf-v6-u-mt-md">
                <CardBody>
                    <Toolbar>
                        <ToolbarContent>
                            <ToolbarItem>
                                <ToggleGroup aria-label={_("Filter by kind")}>
                                    {KINDS.map(k => (
                                        <ToggleGroupItem key={k.key} text={k.label()} buttonId={k.key}
                                                         isSelected={kind === k.key}
                                                         onChange={() => setKind(k.key)} />
                                    ))}
                                </ToggleGroup>
                            </ToolbarItem>
                            <ToolbarItem>
                                <SearchInput placeholder={_("Search address or filter")} value={search}
                                             onChange={(_e, v) => setSearch(v)} onClear={() => setSearch('')} />
                            </ToolbarItem>
                            <ToolbarItem align={{ default: 'alignEnd' }}>
                                <Button variant="secondary" onClick={() => { setLimit(l => l + 500) }}>
                                    {_("Load more")}
                                </Button>
                            </ToolbarItem>
                        </ToolbarContent>
                    </Toolbar>

                    {shown.length === 0
                        ? <Empty icon={HistoryIcon} title={_("No events")}
                                 body={(state.events || []).length === 0
                                     ? _("Nothing has been recorded yet. Bans and service restarts will appear here.")
                                     : _("No event matches the current filter.")} />
                        : <Table variant="compact" aria-label={_("Events")}>
                            <Thead>
                                <Tr>
                                    <Th width={15}>{_("When")}</Th>
                                    <Th width={10}>{_("Kind")}</Th>
                                    <Th width={20}>{_("Network")}</Th>
                                    <Th>{_("Detail")}</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {shown.map((e, i) => (
                                    <Tr key={`${e.ts}-${i}`}>
                                        <Td dataLabel={_("When")}>
                                            <Tooltip content={formatTimestamp(e.ts)}>
                                                <span>{relativeTime(e.ts)}</span>
                                            </Tooltip>
                                        </Td>
                                        <Td dataLabel={_("Kind")}><KindLabel event={e} /></Td>
                                        <Td dataLabel={_("Network")}>{e.net ? <code>{e.net}</code> : '—'}</Td>
                                        <Td dataLabel={_("Detail")}>{describe(e)}</Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>}
                </CardBody>
            </Card>
        </>
    );
}
