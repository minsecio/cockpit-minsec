import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Card, CardBody, Button, Switch, Label, Alert, Modal, ModalHeader, ModalBody,
    ModalFooter, Form, FormGroup, TextInput, TextArea, Radio, Content,
    ContentVariants, DescriptionList, DescriptionListGroup, DescriptionListTerm,
    DescriptionListDescription, Toolbar, ToolbarContent, ToolbarItem, SearchInput,
    Title, Split, SplitItem, Flex, FlexItem, LabelGroup, CodeBlock, CodeBlockCode,
    Spinner, HelperText, HelperTextItem, Stack, StackItem,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td, ExpandableRowContent } from '@patternfly/react-table';
import { OutlinedQuestionCircleIcon, FlaskIcon } from '@patternfly/react-icons';
import cockpit from 'cockpit';

import * as minsec from './minsec.js';
import { Loading, Failure, Empty } from './common.jsx';
import { humanDuration } from './util.js';

const _ = cockpit.gettext;

function TestDialog({ filter, isOpen, onClose, onHelp }) {
    const [mode, setMode] = useState('paste');
    const [text, setText] = useState('');
    const [path, setPath] = useState('');
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isOpen) {
            setText(''); setResult(null); setError(null); setBusy(false); setMode('paste');
            // Offer the filter's own first log file as the obvious thing to test.
            setPath(filter?.definition?.files?.[0] || '');
        }
    }, [isOpen, filter]);

    const run = async () => {
        setBusy(true);
        setError(null);
        setResult(null);
        try {
            const r = mode === 'paste'
                ? await minsec.testFilter(filter.name, { text: text.endsWith('\n') ? text : text + '\n' })
                : await minsec.testFilter(filter.name, { file: path.trim() });
            setResult(r);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    if (!filter)
        return null;

    const canRun = !busy && (mode === 'paste' ? text.trim() !== '' : path.trim() !== '');

    return (
        <Modal isOpen={isOpen} onClose={onClose} variant="large">
            <ModalHeader title={cockpit.format(_("Test the $0 filter"), filter.name)} />
            <ModalBody>
                <Stack hasGutter>
                    <StackItem>
                        <Alert variant="info" isInline isPlain title={_("This only reads. It cannot ban anyone.")}>
                            {_("Testing matches text against the filter's patterns and shows what it found. Retry limits, the allow list and the firewall are all skipped.")}
                            {' '}
                            <Button variant="link" isInline onClick={() => onHelp('testing')}>{_("Learn more")}</Button>
                        </Alert>
                    </StackItem>
                    <StackItem>
                        <Form>
                            <FormGroup role="radiogroup" isInline fieldId="test-mode" label={_("Log source")}>
                                <Radio id="test-paste" name="test-mode" label={_("Paste log lines")}
                                       isChecked={mode === 'paste'} onChange={() => setMode('paste')} />
                                <Radio id="test-file" name="test-mode" label={_("Read a log file")}
                                       isChecked={mode === 'file'} onChange={() => setMode('file')} />
                            </FormGroup>
                            {mode === 'paste'
                                ? <FormGroup label={_("Log lines")} fieldId="test-text">
                                    <TextArea id="test-text" rows={7} value={text} resizeOrientation="vertical"
                                              onChange={(_e, v) => setText(v)}
                                              placeholder={_("Paste a few lines from the service's log…")} />
                                </FormGroup>
                                : <FormGroup label={_("Path")} fieldId="test-path">
                                    <TextInput id="test-path" value={path} onChange={(_e, v) => setPath(v)}
                                               placeholder="/var/log/secure" />
                                    <HelperText>
                                        <HelperTextItem>
                                            {_("A large file takes a moment. minsec reads about 5 million lines per second.")}
                                        </HelperTextItem>
                                    </HelperText>
                                </FormGroup>}
                        </Form>
                    </StackItem>

                    {error && <StackItem><Alert variant="danger" isInline title={_("The test failed")}>{error}</Alert></StackItem>}

                    {busy && <StackItem><Flex><FlexItem><Spinner size="md" /></FlexItem>
                        <FlexItem>{_("Testing…")}</FlexItem></Flex></StackItem>}

                    {result &&
                        <StackItem>
                            {result.matched === 0
                                ? <Alert variant="warning" isInline title={_("No lines matched")}>
                                    {_("The filter did not recognise anything here as a failure. If these lines should have counted, the filter's patterns need adjusting.")}
                                </Alert>
                                : <>
                                    <Alert variant="success" isInline
                                           title={cockpit.format(
                                               cockpit.ngettext("$0 line matched, from $1 address",
                                                                "$0 lines matched, from $1 addresses",
                                                                result.matched),
                                               result.matched, Object.keys(result.addresses).length)} />
                                    <Table variant="compact" aria-label={_("Matches")} className="pf-v6-u-mt-md">
                                        <Thead>
                                            <Tr>
                                                <Th width={20}>{_("Address")}</Th>
                                                <Th width={15}>{_("User")}</Th>
                                                <Th width={10}>{_("Pattern")}</Th>
                                                <Th>{_("Line")}</Th>
                                            </Tr>
                                        </Thead>
                                        <Tbody>
                                            {result.matches.slice(0, 200).map((m, i) => (
                                                <Tr key={i}>
                                                    <Td dataLabel={_("Address")}><code>{m.ip}</code></Td>
                                                    <Td dataLabel={_("User")}>{m.user || '—'}</Td>
                                                    <Td dataLabel={_("Pattern")}>#{m.pattern}</Td>
                                                    <Td dataLabel={_("Line")} className="ct-log-line">{m.line}</Td>
                                                </Tr>
                                            ))}
                                        </Tbody>
                                    </Table>
                                    {result.matches.length > 200 &&
                                        <Content component={ContentVariants.small}>
                                            {cockpit.format(_("Showing the first 200 of $0 matches."),
                                                            result.matches.length)}
                                        </Content>}
                                </>}
                        </StackItem>}
                </Stack>
            </ModalBody>
            <ModalFooter>
                <Button variant="primary" onClick={run} isDisabled={!canRun} isLoading={busy}>
                    {_("Run test")}
                </Button>
                <Button variant="link" onClick={onClose}>{_("Close")}</Button>
            </ModalFooter>
        </Modal>
    );
}

function FilterDetail({ filter }) {
    const def = filter.definition || {};
    const policy = filter.effective_policy || {};
    const journal = def.journal || {};
    const journalSelectors = [...journal.units || [], ...journal.identifiers || [], ...journal.comm || []];
    const usesJournal = journalSelectors.length > 0;

    return (
        <ExpandableRowContent>
            <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsMd' }}>
                <FlexItem>
                    <DescriptionList isHorizontal isCompact columnModifier={{ lg: '2Col' }}>
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Policy")}</DescriptionListTerm>
                            <DescriptionListDescription>
                                {cockpit.format(_("$0 tries within $1, then blocked for $2"),
                                                policy.maxretry,
                                                humanDuration(policy.findtime_seconds),
                                                humanDuration(policy.bantime_seconds))}
                                {policy.escalation === false && <> · {_("no escalation")}</>}
                            </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Definition")}</DescriptionListTerm>
                            <DescriptionListDescription>
                                {filter.builtin ? _("Built in") : _("Custom")}
                                {filter.source && filter.source !== 'built-in' && <> · <code>{filter.source}</code></>}
                            </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Reads from")}</DescriptionListTerm>
                            <DescriptionListDescription>
                                {usesJournal
                                    ? <>
                                        <Label isCompact color="blue">{_("systemd journal")}</Label>
                                        <Content component={ContentVariants.small}>
                                            {journalSelectors.join(', ')}
                                        </Content>
                                    </>
                                    : (def.files || []).length
                                        ? <ul className="ct-path-list">
                                            {def.files.map(f => <li key={f}><code>{f}</code></li>)}
                                        </ul>
                                        : _("Nothing configured")}
                                {usesJournal && (def.files || []).length > 0 &&
                                    <Content component={ContentVariants.small}>
                                        {_("Falls back to this filter's files if the journal is unavailable or switched off.")}
                                    </Content>}
                            </DescriptionListDescription>
                        </DescriptionListGroup>
                        {(def.ports || []).length > 0 &&
                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("Service ports")}</DescriptionListTerm>
                                <DescriptionListDescription>
                                    <LabelGroup>
                                        {def.ports.map(p => <Label key={p} isCompact>{p}</Label>)}
                                    </LabelGroup>
                                </DescriptionListDescription>
                            </DescriptionListGroup>}
                    </DescriptionList>
                </FlexItem>
                <FlexItem>
                    <Content component={ContentVariants.h4}>
                        {cockpit.format(_("Patterns ($0)"), (def.patterns || []).length)}
                    </Content>
                    <CodeBlock>
                        <CodeBlockCode>{(def.patterns || []).join('\n')}</CodeBlockCode>
                    </CodeBlock>
                </FlexItem>
                {(def.ignore || []).length > 0 &&
                    <FlexItem>
                        <Content component={ContentVariants.h4}>{_("Never counted")}</Content>
                        <CodeBlock><CodeBlockCode>{def.ignore.join('\n')}</CodeBlockCode></CodeBlock>
                    </FlexItem>}
            </Flex>
        </ExpandableRowContent>
    );
}

export default function Filters({ ctx }) {
    const [state, setState] = useState({ loading: true });
    const [expanded, setExpanded] = useState({});
    const [search, setSearch] = useState('');
    const [pending, setPending] = useState({});
    const [testing, setTesting] = useState(null);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        try {
            const doc = await minsec.inspect();
            setState({ loading: false, filters: doc.filters || [] });
        } catch (err) {
            setState({ loading: false, error: err });
        }
    }, []);

    useEffect(() => { load() }, [load, ctx.reloadKey]);

    const toggle = useCallback(async (filter, enable) => {
        setPending(p => ({ ...p, [filter.name]: true }));
        setError(null);
        try {
            if (enable)
                await minsec.enableFilter(filter.name);
            else
                await minsec.disableFilter(filter.name);
            ctx.needsRestart();
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setPending(p => ({ ...p, [filter.name]: false }));
        }
    }, [load, ctx]);

    const shown = useMemo(() => {
        const filters = state.filters || [];
        const q = search.trim().toLowerCase();
        if (!q)
            return filters;
        return filters.filter(f => f.name.toLowerCase().includes(q) ||
                                   (f.definition?.description || '').toLowerCase().includes(q));
    }, [state.filters, search]);

    if (state.loading)
        return <Loading />;
    if (state.error)
        return <Failure error={state.error} onRetry={load} />;

    const enabledCount = (state.filters || []).filter(f => f.enabled).length;

    return (
        <>
            <Card>
                <CardBody>
                    <Split hasGutter>
                        <SplitItem isFilled>
                            <Title headingLevel="h2" size="lg">{_("Filters")}</Title>
                            <Content component={ContentVariants.small}>
                                {cockpit.format(
                                    cockpit.ngettext("$0 of $1 filter enabled.", "$0 of $1 filters enabled.",
                                                     state.filters.length),
                                    enabledCount, state.filters.length)}
                                {' '}
                                {_("Each filter watches one service's logs for failures.")}
                                {' '}
                                <Button variant="link" isInline onClick={() => ctx.openHelp('filters')}>
                                    {_("Learn more")}
                                </Button>
                            </Content>
                        </SplitItem>
                    </Split>
                </CardBody>
            </Card>

            {error && <Alert variant="danger" isInline title={error} className="pf-v6-u-mt-md" />}

            <Card className="pf-v6-u-mt-md">
                <CardBody>
                    <Toolbar>
                        <ToolbarContent>
                            <ToolbarItem>
                                <SearchInput placeholder={_("Search filters")} value={search}
                                             onChange={(_e, v) => setSearch(v)} onClear={() => setSearch('')} />
                            </ToolbarItem>
                        </ToolbarContent>
                    </Toolbar>

                    {shown.length === 0
                        ? <Empty title={_("No matching filters")}
                                 body={cockpit.format(_("No filter matches \"$0\"."), search)} />
                        : <Table variant="compact" aria-label={_("Filters")}>
                            <Thead>
                                <Tr>
                                    <Th screenReaderText={_("Details")} />
                                    <Th width={20}>{_("Filter")}</Th>
                                    <Th width={45}>{_("Watches for")}</Th>
                                    <Th width={20}>{_("Enabled")}</Th>
                                    <Th screenReaderText={_("Actions")} />
                                </Tr>
                            </Thead>
                            {shown.map((f, rowIndex) => (
                                <Tbody key={f.name} isExpanded={!!expanded[f.name]}>
                                    <Tr>
                                        <Td expand={{
                                            rowIndex,
                                            isExpanded: !!expanded[f.name],
                                            onToggle: () => setExpanded(e => ({ ...e, [f.name]: !e[f.name] })),
                                            expandId: `filter-${f.name}`,
                                        }} />
                                        <Td dataLabel={_("Filter")}>
                                            <Flex spaceItems={{ default: 'spaceItemsXs' }}
                                                  alignItems={{ default: 'alignItemsCenter' }}>
                                                <FlexItem><strong>{f.name}</strong></FlexItem>
                                                {!f.builtin &&
                                                    <FlexItem>
                                                        <Label isCompact variant="outline">{_("custom")}</Label>
                                                    </FlexItem>}
                                            </Flex>
                                        </Td>
                                        <Td dataLabel={_("Watches for")}>
                                            {f.definition?.description || '—'}
                                        </Td>
                                        <Td dataLabel={_("Enabled")}>
                                            <Switch id={`filter-switch-${f.name}`}
                                                    aria-label={cockpit.format(_("Enable the $0 filter"), f.name)}
                                                    isChecked={!!f.enabled}
                                                    isDisabled={!!pending[f.name] || ctx.admin === false}
                                                    onChange={(_e, checked) => toggle(f, checked)} />
                                        </Td>
                                        <Td isActionCell>
                                            <Button variant="secondary" size="sm" icon={<FlaskIcon />}
                                                    onClick={() => setTesting(f)}>
                                                {_("Test")}
                                            </Button>
                                        </Td>
                                    </Tr>
                                    <Tr isExpanded={!!expanded[f.name]}>
                                        <Td />
                                        <Td colSpan={4}><FilterDetail filter={f} /></Td>
                                    </Tr>
                                </Tbody>
                            ))}
                        </Table>}
                </CardBody>
            </Card>

            <TestDialog filter={testing} isOpen={testing !== null}
                        onClose={() => setTesting(null)} onHelp={ctx.openHelp} />
        </>
    );
}
