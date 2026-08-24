import React, { useState, useEffect, useCallback } from 'react';
import {
    Card, CardBody, CardHeader, CardTitle, Form, FormGroup, TextInput, TextArea,
    Switch, Radio, Button, Alert, ActionGroup, HelperText, HelperTextItem,
    Content, ContentVariants, Grid, GridItem, Split, SplitItem, Title,
    ExpandableSection, Stack, StackItem, Label,
} from '@patternfly/react-core';
import cockpit from 'cockpit';

import * as minsec from './minsec.js';
import { Loading, Failure } from './common.jsx';
import { FieldHelp } from './help.jsx';
import { formatDuration, isValidDuration, tomlString, tomlStringArray } from './util.js';
import ConfigFiles from './ConfigFiles.jsx';

const _ = cockpit.gettext;

/*
 * Settings written here go to a drop-in rather than minsec.toml, so a
 * hand-maintained main config is never rewritten. Drop-ins are merged in
 * lexical order and this name sorts last, so what the form shows is what
 * takes effect.
 */
const DROPIN = '/etc/minsec/conf.d/zz-cockpit.toml';

function defaultsToForm(d) {
    return {
        bantime: formatDuration(d.bantime_seconds),
        findtime: formatDuration(d.findtime_seconds),
        maxretry: String(d.maxretry),
        escalate_enabled: !!d.escalate_enabled,
        escalate_factor: String(d.escalate?.factor ?? 2),
        escalate_max: formatDuration(d.escalate?.max_seconds ?? 604800),
        escalate_memory: formatDuration(d.escalate?.memory_seconds ?? 2592000),
        allow: (d.allow || []).join('\n'),
        backend: d.backend || 'nft',
        exec_command: d.exec_command || '',
        ipv6_prefix: String(d.ipv6_prefix ?? 64),
        max_tracked: String(d.max_tracked ?? 50000),
        journal: d.journal !== false,
    };
}

function validate(f) {
    const errors = {};
    for (const k of ['bantime', 'findtime', 'escalate_max', 'escalate_memory']) {
        if (!isValidDuration(f[k]))
            errors[k] = _("Use a number with a unit: s, m, h, d or w.");
    }
    const retry = parseInt(f.maxretry, 10);
    if (!(retry >= 1 && retry <= 32))
        errors.maxretry = _("Must be a whole number from 1 to 32.");
    const factor = parseInt(f.escalate_factor, 10);
    if (!(factor >= 1))
        errors.escalate_factor = _("Must be a whole number of at least 1.");
    const prefix = parseInt(f.ipv6_prefix, 10);
    if (!(prefix >= 1 && prefix <= 128))
        errors.ipv6_prefix = _("Must be a whole number from 1 to 128.");
    const tracked = parseInt(f.max_tracked, 10);
    if (!(tracked >= 1))
        errors.max_tracked = _("Must be a whole number of at least 1.");
    if (f.backend === 'exec' && !f.exec_command.trim())
        errors.exec_command = _("A command is required when using a custom command backend.");
    return errors;
}

function toToml(f) {
    const allow = f.allow.split('\n').map(s => s.trim()).filter(Boolean);
    return [
        '# Written by the Cockpit interface. Settings here override minsec.toml.',
        '',
        '[defaults]',
        `bantime = ${tomlString(f.bantime)}`,
        `findtime = ${tomlString(f.findtime)}`,
        `maxretry = ${parseInt(f.maxretry, 10)}`,
        `escalate_enabled = ${f.escalate_enabled}`,
        `escalate = { factor = ${parseInt(f.escalate_factor, 10)}, ` +
            `max = ${tomlString(f.escalate_max)}, memory = ${tomlString(f.escalate_memory)} }`,
        `allow = ${tomlStringArray(allow)}`,
        `backend = ${tomlString(f.backend)}`,
        ...f.backend === 'exec' ? [`exec_command = ${tomlString(f.exec_command.trim())}`] : [],
        `ipv6_prefix = ${parseInt(f.ipv6_prefix, 10)}`,
        `max_tracked = ${parseInt(f.max_tracked, 10)}`,
        `journal = ${f.journal}`,
        '',
    ].join('\n');
}

function Field({ label, name, children, error, hint }) {
    return (
        <FormGroup label={label} fieldId={name} labelHelp={<FieldHelp name={name} />}>
            {children}
            {(error || hint) &&
                <HelperText>
                    <HelperTextItem variant={error ? 'error' : 'default'}>{error || hint}</HelperTextItem>
                </HelperText>}
        </FormGroup>
    );
}

export default function Settings({ ctx }) {
    const [state, setState] = useState({ loading: true });
    const [form, setForm] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [saved, setSaved] = useState(false);

    const load = useCallback(async () => {
        try {
            const doc = await minsec.inspect();
            setState({ loading: false, doc });
            setForm(defaultsToForm(doc.effective.defaults));
        } catch (err) {
            setState({ loading: false, error: err });
        }
    }, []);

    useEffect(() => { load() }, [load, ctx.reloadKey]);

    const set = (k, v) => {
        setForm(f => ({ ...f, [k]: v }));
        setSaved(false);
    };

    const errors = form ? validate(form) : {};
    const hasErrors = Object.keys(errors).length > 0;

    const save = useCallback(async () => {
        setSaving(true);
        setSaveError(null);
        try {
            await minsec.writeFile(DROPIN, toToml(form));
            const result = await minsec.check(true);
            if (result.ok === false) {
                setSaveError((result.errors || [])
                        .map(e => e.filter ? `${e.filter}: ${e.error}` : e.error).join('\n'));
                return;
            }
            setSaved(true);
            ctx.needsRestart();
            await load();
        } catch (err) {
            setSaveError(err.message);
        } finally {
            setSaving(false);
        }
    }, [form, ctx, load]);

    if (state.loading)
        return <Loading />;
    if (state.error)
        return <Failure error={state.error} onRetry={load} />;

    const readOnly = ctx.admin === false;

    return (
        <Stack hasGutter>
            <StackItem>
                <Card>
                    <CardBody>
                        <Title headingLevel="h2" size="lg">{_("Settings")}</Title>
                        <Content component={ContentVariants.small}>
                            {_("These apply to every filter unless a filter overrides them.")}
                            {' '}
                            {cockpit.format(_("They are stored in $0, which takes precedence over the main configuration file."), DROPIN)}
                        </Content>
                    </CardBody>
                </Card>
            </StackItem>

            {saveError &&
                <StackItem>
                    <Alert variant="danger" isInline title={_("minsec rejected these settings")}>
                        <Content component={ContentVariants.pre} className="ct-error-detail">{saveError}</Content>
                    </Alert>
                </StackItem>}

            {saved && !saveError &&
                <StackItem>
                    <Alert variant="success" isInline title={_("Settings saved")} />
                </StackItem>}

            <StackItem>
                <Card>
                    <CardHeader><CardTitle>{_("When to ban")}</CardTitle></CardHeader>
                    <CardBody>
                        <Form isHorizontal>
                            <Grid hasGutter>
                                <GridItem span={12} md={4}>
                                    <Field label={_("Retry limit")} name="maxretry" error={errors.maxretry}
                                           hint={_("Failures before a ban")}>
                                        <TextInput id="maxretry" type="number" min={1} max={32} value={form.maxretry}
                                                   isDisabled={readOnly}
                                                   validated={errors.maxretry ? 'error' : 'default'}
                                                   onChange={(_e, v) => set('maxretry', v)} />
                                    </Field>
                                </GridItem>
                                <GridItem span={12} md={4}>
                                    <Field label={_("Find time")} name="findtime" error={errors.findtime}
                                           hint={_("Window the failures must fall in")}>
                                        <TextInput id="findtime" value={form.findtime} isDisabled={readOnly}
                                                   validated={errors.findtime ? 'error' : 'default'}
                                                   onChange={(_e, v) => set('findtime', v)} />
                                    </Field>
                                </GridItem>
                                <GridItem span={12} md={4}>
                                    <Field label={_("Ban time")} name="bantime" error={errors.bantime}
                                           hint={_("How long the block lasts")}>
                                        <TextInput id="bantime" value={form.bantime} isDisabled={readOnly}
                                                   validated={errors.bantime ? 'error' : 'default'}
                                                   onChange={(_e, v) => set('bantime', v)} />
                                    </Field>
                                </GridItem>
                            </Grid>
                            <Content component={ContentVariants.small}>
                                {!hasErrors && cockpit.format(
                                    _("In plain terms: $0 failures from one network within $1 results in a block lasting $2."),
                                    form.maxretry, form.findtime, form.bantime)}
                            </Content>
                        </Form>
                    </CardBody>
                </Card>
            </StackItem>

            <StackItem>
                <Card>
                    <CardHeader><CardTitle>{_("Repeat offenders")}</CardTitle></CardHeader>
                    <CardBody>
                        <Form isHorizontal>
                            <FormGroup fieldId="escalate_enabled" labelHelp={<FieldHelp name="escalate_enabled" />}
                                       label={_("Ban repeat offenders for longer")}>
                                <Switch id="escalate_enabled" isChecked={form.escalate_enabled}
                                        isDisabled={readOnly}
                                        aria-label={_("Ban repeat offenders for longer")}
                                        onChange={(_e, v) => set('escalate_enabled', v)} />
                            </FormGroup>
                            {form.escalate_enabled &&
                                <Grid hasGutter>
                                    <GridItem span={12} md={4}>
                                        <Field label={_("Multiplier")} name="escalate_factor"
                                               error={errors.escalate_factor}
                                               hint={_("Per previous ban")}>
                                            <TextInput id="escalate_factor" type="number" min={1}
                                                       value={form.escalate_factor} isDisabled={readOnly}
                                                       validated={errors.escalate_factor ? 'error' : 'default'}
                                                       onChange={(_e, v) => set('escalate_factor', v)} />
                                        </Field>
                                    </GridItem>
                                    <GridItem span={12} md={4}>
                                        <Field label={_("Longest ban")} name="escalate_max" error={errors.escalate_max}>
                                            <TextInput id="escalate_max" value={form.escalate_max}
                                                       isDisabled={readOnly}
                                                       validated={errors.escalate_max ? 'error' : 'default'}
                                                       onChange={(_e, v) => set('escalate_max', v)} />
                                        </Field>
                                    </GridItem>
                                    <GridItem span={12} md={4}>
                                        <Field label={_("Remember for")} name="escalate_memory"
                                               error={errors.escalate_memory}>
                                            <TextInput id="escalate_memory" value={form.escalate_memory}
                                                       isDisabled={readOnly}
                                                       validated={errors.escalate_memory ? 'error' : 'default'}
                                                       onChange={(_e, v) => set('escalate_memory', v)} />
                                        </Field>
                                    </GridItem>
                                </Grid>}
                        </Form>
                    </CardBody>
                </Card>
            </StackItem>

            <StackItem>
                <Card>
                    <CardHeader><CardTitle>{_("Never ban these")}</CardTitle></CardHeader>
                    <CardBody>
                        <Form>
                            <Field label={_("Addresses and networks")} name="allow"
                                   hint={_("One per line. This machine's own addresses and loopback are always protected.")}>
                                <TextArea id="allow" value={form.allow} rows={5} isDisabled={readOnly}
                                          onChange={(_e, v) => set('allow', v)} spellCheck={false}
                                          placeholder={"203.0.113.0/24\n2001:db8::/32"} />
                            </Field>
                        </Form>
                    </CardBody>
                </Card>
            </StackItem>

            <StackItem>
                <Card>
                    <CardHeader><CardTitle>{_("How to block")}</CardTitle></CardHeader>
                    <CardBody>
                        <Form>
                            <FormGroup role="radiogroup" fieldId="backend" label={_("Firewall backend")}
                                       labelHelp={<FieldHelp name="backend" />}>
                                <Radio id="backend-nft" name="backend" isDisabled={readOnly}
                                       label={_("nftables")}
                                       description={_("Maintains its own table alongside firewalld or an existing ruleset, without touching their rules. The normal choice.")}
                                       isChecked={form.backend === 'nft'} onChange={() => set('backend', 'nft')} />
                                <Radio id="backend-null" name="backend" isDisabled={readOnly}
                                       label={_("Observe only")}
                                       description={_("Records what it would do and changes nothing. Useful while tuning filters.")}
                                       isChecked={form.backend === 'null'} onChange={() => set('backend', 'null')} />
                                <Radio id="backend-exec" name="backend" isDisabled={readOnly}
                                       label={_("Custom command")}
                                       description={_("Runs a command of yours for each ban and unban, for firewalls minsec does not manage directly.")}
                                       isChecked={form.backend === 'exec'} onChange={() => set('backend', 'exec')} />
                            </FormGroup>
                            {form.backend === 'exec' &&
                                <Field label={_("Command")} name="exec_command" error={errors.exec_command}
                                       hint={_("Called as: setup, then ban <network> <seconds> and unban <network>.")}>
                                    <TextInput id="exec_command" value={form.exec_command} isDisabled={readOnly}
                                               validated={errors.exec_command ? 'error' : 'default'}
                                               onChange={(_e, v) => set('exec_command', v)}
                                               placeholder="/usr/local/sbin/my-firewall-hook" />
                                </Field>}
                            {form.backend === 'null' &&
                                <Alert variant="warning" isInline isPlain
                                       title={_("Nothing will be blocked while this is selected.")} />}
                            {form.backend === 'exec' &&
                                <Alert variant="warning" isInline isPlain title={_("This command runs as root")}>
                                    {_("It is trusted configuration and runs with the daemon's privileges for every ban and unban.")}
                                </Alert>}
                        </Form>
                    </CardBody>
                </Card>
            </StackItem>

            <StackItem>
                <ExpandableSection toggleText={_("Advanced")}>
                    <Card>
                        <CardBody>
                            <Form isHorizontal>
                                <Field label={_("Prefer the systemd journal")} name="journal">
                                    <Switch id="journal" isChecked={form.journal} isDisabled={readOnly}
                                            aria-label={_("Prefer the systemd journal")}
                                            onChange={(_e, v) => set('journal', v)} />
                                </Field>
                                <Field label={_("IPv6 prefix length")} name="ipv6_prefix" error={errors.ipv6_prefix}
                                       hint={_("IPv6 is banned a whole network at a time, not one address at a time.")}>
                                    <TextInput id="ipv6_prefix" type="number" min={1} max={128}
                                               value={form.ipv6_prefix} isDisabled={readOnly}
                                               validated={errors.ipv6_prefix ? 'error' : 'default'}
                                               onChange={(_e, v) => set('ipv6_prefix', v)} />
                                </Field>
                                <Field label={_("Tracking limit")} name="max_tracked" error={errors.max_tracked}
                                       hint={_("Networks kept in memory at once.")}>
                                    <TextInput id="max_tracked" type="number" min={1} value={form.max_tracked}
                                               isDisabled={readOnly}
                                               validated={errors.max_tracked ? 'error' : 'default'}
                                               onChange={(_e, v) => set('max_tracked', v)} />
                                </Field>
                            </Form>
                        </CardBody>
                    </Card>
                </ExpandableSection>
            </StackItem>

            <StackItem>
                <ActionGroup>
                    <Button variant="primary" onClick={save} isDisabled={hasErrors || saving || readOnly}
                            isLoading={saving}>
                        {_("Save settings")}
                    </Button>
                    <Button variant="link" onClick={load} isDisabled={saving}>{_("Discard changes")}</Button>
                </ActionGroup>
            </StackItem>

            <StackItem>
                <ConfigFiles doc={state.doc} onChanged={load} ctx={ctx} />
            </StackItem>
        </Stack>
    );
}
