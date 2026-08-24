import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Card, CardBody, Toolbar, ToolbarContent, ToolbarItem, SearchInput, Button,
    Modal, ModalHeader, ModalBody, ModalFooter, Form, FormGroup, TextInput,
    Alert, Label, Content, ContentVariants, HelperText, HelperTextItem,
    Flex, FlexItem, Split, SplitItem, Title,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td, ActionsColumn } from '@patternfly/react-table';
import { BanIcon, OutlinedQuestionCircleIcon } from '@patternfly/react-icons';
import cockpit from 'cockpit';

import * as minsec from './minsec.js';
import { Loading, Failure, Empty } from './common.jsx';
import { humanDuration, isValidNetwork, isValidDuration } from './util.js';
import { FieldHelp } from './help.jsx';

const _ = cockpit.gettext;

function BanDialog({ isOpen, onClose, onDone }) {
    const [net, setNet] = useState('');
    const [ttl, setTtl] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isOpen) {
            setNet(''); setTtl(''); setError(null); setBusy(false);
        }
    }, [isOpen]);

    const netValid = net === '' || isValidNetwork(net);
    const ttlValid = ttl === '' || isValidDuration(ttl);
    const canSubmit = net !== '' && netValid && ttlValid && !busy;

    const submit = async () => {
        setBusy(true);
        setError(null);
        try {
            await minsec.ban(net.trim(), ttl.trim() || null);
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
            <ModalHeader title={_("Block an address")} />
            <ModalBody>
                <Form onSubmit={e => { e.preventDefault(); if (canSubmit) submit() }}>
                    {error && <Alert variant="danger" isInline title={_("Could not add the ban")}>{error}</Alert>}
                    <FormGroup label={_("Address or network")} isRequired fieldId="ban-net">
                        <TextInput id="ban-net" value={net} onChange={(_e, v) => setNet(v)}
                                   validated={netValid ? 'default' : 'error'}
                                   placeholder="198.51.100.7" autoFocus />
                        <HelperText>
                            <HelperTextItem variant={netValid ? 'default' : 'error'}>
                                {netValid
                                    ? _("A single address, or a range such as 198.51.100.0/24.")
                                    : _("Enter a valid IPv4 or IPv6 address, optionally with a prefix length.")}
                            </HelperTextItem>
                        </HelperText>
                    </FormGroup>
                    <FormGroup label={_("Duration")} fieldId="ban-ttl"
                               labelHelp={<FieldHelp name="ttl" />}>
                        <TextInput id="ban-ttl" value={ttl} onChange={(_e, v) => setTtl(v)}
                                   validated={ttlValid ? 'default' : 'error'}
                                   placeholder={_("default ban time")} />
                        <HelperText>
                            <HelperTextItem variant={ttlValid ? 'default' : 'error'}>
                                {ttlValid
                                    ? _("For example 30m, 1h, 2d or 1w. Leave empty to use the configured default.")
                                    : _("Use a number with a unit: s, m, h, d or w.")}
                            </HelperTextItem>
                        </HelperText>
                    </FormGroup>
                </Form>
            </ModalBody>
            <ModalFooter>
                <Button variant="primary" onClick={submit} isDisabled={!canSubmit} isLoading={busy}>
                    {_("Block")}
                </Button>
                <Button variant="link" onClick={onClose}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
}

export default function Bans({ ctx }) {
    const [state, setState] = useState({ loading: true });
    const [search, setSearch] = useState('');
    const [dialog, setDialog] = useState(false);
    const [actionError, setActionError] = useState(null);

    const load = useCallback(async () => {
        try {
            const bans = await minsec.listBans();
            setState({ loading: false, bans });
        } catch (err) {
            setState({ loading: false, error: err });
        }
    }, []);

    useEffect(() => { load() }, [load, ctx.reloadKey]);
    useEffect(() => {
        const t = setInterval(load, 15000);
        return () => clearInterval(t);
    }, [load]);

    const unban = useCallback(async net => {
        setActionError(null);
        try {
            await minsec.unban(net);
            await load();
        } catch (err) {
            setActionError(err.message);
        }
    }, [load]);

    const shown = useMemo(() => {
        const bans = state.bans || [];
        const q = search.trim().toLowerCase();
        if (!q)
            return bans;
        return bans.filter(b => b.net.toLowerCase().includes(q) ||
                                (b.filter || '').toLowerCase().includes(q));
    }, [state.bans, search]);

    if (state.loading)
        return <Loading />;
    if (state.error)
        return <Failure error={state.error} onRetry={load}
                        onStart={() => minsec.unitAction('minsec.service', 'start').then(load)} />;

    const total = (state.bans || []).length;

    return (
        <>
            <Card>
                <CardBody>
                    <Split hasGutter>
                        <SplitItem isFilled>
                            <Title headingLevel="h2" size="lg">{_("Blocked networks")}</Title>
                            <Content component={ContentVariants.small}>
                                {_("Read from the kernel firewall, so this is what is actually blocked right now.")}
                                {' '}
                                <Button variant="link" isInline onClick={() => ctx.openHelp('bans')}>
                                    {_("Learn more")}
                                </Button>
                            </Content>
                        </SplitItem>
                    </Split>
                </CardBody>
            </Card>

            {actionError && <Alert variant="danger" isInline title={actionError} className="pf-v6-u-mt-md" />}

            <Card className="pf-v6-u-mt-md">
                <CardBody>
                    <Toolbar>
                        <ToolbarContent>
                            <ToolbarItem>
                                <SearchInput placeholder={_("Search address or filter")} value={search}
                                             onChange={(_e, v) => setSearch(v)} onClear={() => setSearch('')} />
                            </ToolbarItem>
                            <ToolbarItem align={{ default: 'alignEnd' }}>
                                <Button variant="primary" onClick={() => setDialog(true)}>
                                    {_("Block an address")}
                                </Button>
                            </ToolbarItem>
                        </ToolbarContent>
                    </Toolbar>

                    {total === 0
                        ? <Empty icon={BanIcon} title={_("Nothing is blocked")}
                                 body={_("No network is currently banned. Automatic bans will appear here as filters catch abuse.")}
                                 action={<Button variant="secondary" onClick={() => setDialog(true)}>
                                     {_("Block an address")}
                                 </Button>} />
                        : shown.length === 0
                            ? <Empty title={_("No matches")}
                                     body={cockpit.format(_("No blocked network matches \"$0\"."), search)} />
                            : <Table variant="compact" aria-label={_("Blocked networks")}>
                                <Thead>
                                    <Tr>
                                        <Th width={40}>{_("Network")}</Th>
                                        <Th width={30}>{_("Caught by")}</Th>
                                        <Th width={25}>{_("Unblocks in")}</Th>
                                        <Th screenReaderText={_("Actions")} />
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {shown.map(b => (
                                        <Tr key={b.net}>
                                            <Td dataLabel={_("Network")}><code>{b.net}</code></Td>
                                            <Td dataLabel={_("Caught by")}>
                                                {b.filter
                                                    ? <Label isCompact color="orange">{b.filter}</Label>
                                                    : <Label isCompact variant="outline">{_("Added manually")}</Label>}
                                            </Td>
                                            <Td dataLabel={_("Unblocks in")}>
                                                {b.expires_in === null || b.expires_in === undefined
                                                    ? _("Does not expire")
                                                    : humanDuration(b.expires_in)}
                                            </Td>
                                            <Td isActionCell>
                                                <ActionsColumn items={[{
                                                    title: _("Unblock"),
                                                    onClick: () => unban(b.net),
                                                }]} />
                                            </Td>
                                        </Tr>
                                    ))}
                                </Tbody>
                            </Table>}
                </CardBody>
            </Card>

            <BanDialog isOpen={dialog} onClose={() => setDialog(false)} onDone={load} />
        </>
    );
}
