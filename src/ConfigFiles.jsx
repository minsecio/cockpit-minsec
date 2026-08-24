import React, { useState, useEffect, useCallback } from 'react';
import {
    Card, CardBody, CardHeader, CardTitle, Button, Modal, ModalHeader, ModalBody,
    ModalFooter, TextArea, TextInput, Alert, Content, ContentVariants, Label,
    Flex, FlexItem, Spinner, Stack, StackItem, FormGroup, Form, HelperText,
    HelperTextItem,
} from '@patternfly/react-core';
import { Table, Thead, Tbody, Tr, Th, Td, ActionsColumn } from '@patternfly/react-table';
import { PlusCircleIcon } from '@patternfly/react-icons';
import cockpit from 'cockpit';

import * as minsec from './minsec.js';
import { Empty } from './common.jsx';

const _ = cockpit.gettext;

const NEW_FILTER_TEMPLATE = `# A custom filter. See minsec-filter.toml(5).
#
# A file here named <name>.toml completely replaces the built-in filter of
# the same name; definitions are never merged.

name = "myapp"
description = "My application login failures"
files = ["/var/log/myapp.log"]

# Cheap literal check made before the patterns run.
prefilter = ["login failed"]

# <HOST> captures the address. <F-USER>...</F-USER> captures the username.
patterns = [
  'login failed for <F-USER>\\S+</F-USER> from <HOST>',
]

# Lines that must never count, even when a pattern above matches.
ignore = []
`;

/*
 * Edit a config file. minsec validates from disk, so the file is written
 * first and checked afterwards; a failed check offers to put back what was
 * there before rather than leaving a broken config in place.
 */
function EditorDialog({ file, isOpen, onClose, onSaved }) {
    const [content, setContent] = useState('');
    const [original, setOriginal] = useState('');
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [checkErrors, setCheckErrors] = useState(null);

    const isNew = file?.isNew;

    useEffect(() => {
        if (!isOpen)
            return;
        setError(null);
        setCheckErrors(null);
        setBusy(false);
        setName('');
        if (isNew) {
            setContent(NEW_FILTER_TEMPLATE);
            setOriginal(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        minsec.readFile(file.path)
                .then(text => {
                    setContent(text || '');
                    setOriginal(text || '');
                })
                .catch(err => setError(err.message))
                .finally(() => setLoading(false));
    }, [isOpen, file, isNew]);

    const path = isNew ? `/etc/minsec/filters/${name.trim()}.toml` : file?.path;
    const nameValid = !isNew || /^[a-z0-9][a-z0-9._-]*$/.test(name.trim());
    const canSave = !busy && !loading && (!isNew || (name.trim() !== '' && nameValid));

    const save = async () => {
        setBusy(true);
        setError(null);
        setCheckErrors(null);
        try {
            await minsec.writeFile(path, content);
            const result = await minsec.check(true);
            if (result.ok === false) {
                setCheckErrors(result.errors || []);
                return;
            }
            onSaved();
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const revert = async () => {
        setBusy(true);
        try {
            // A new file never existed, so undoing means removing it.
            await minsec.writeFile(path, isNew ? null : original);
            setCheckErrors(null);
            onSaved();
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} variant="large">
            <ModalHeader title={isNew ? _("New custom filter") : file?.path} />
            <ModalBody>
                <Stack hasGutter>
                    {isNew &&
                        <StackItem>
                            <Form>
                                <FormGroup label={_("Filter name")} isRequired fieldId="new-filter-name">
                                    <TextInput id="new-filter-name" value={name} autoFocus
                                               onChange={(_e, v) => setName(v)}
                                               validated={name === '' || nameValid ? 'default' : 'error'}
                                               placeholder="myapp" />
                                    <HelperText>
                                        <HelperTextItem variant={name === '' || nameValid ? 'default' : 'error'}>
                                            {name === '' || nameValid
                                                ? cockpit.format(_("Saved as $0. Use the name of a built-in filter to replace it entirely."),
                                                                 name.trim() ? path : '/etc/minsec/filters/<name>.toml')
                                                : _("Use lowercase letters, digits, dots, underscores and dashes.")}
                                        </HelperTextItem>
                                    </HelperText>
                                </FormGroup>
                            </Form>
                        </StackItem>}

                    {error && <StackItem><Alert variant="danger" isInline title={_("Could not save")}>{error}</Alert></StackItem>}

                    {checkErrors &&
                        <StackItem>
                            <Alert variant="danger" isInline
                                   title={_("Saved, but minsec rejected it")}
                                   actionLinks={
                                       <Button variant="link" isInline onClick={revert} isDisabled={busy}>
                                           {isNew ? _("Delete this file") : _("Put back the previous version")}
                                       </Button>
                                   }>
                                <Content component={ContentVariants.pre} className="ct-error-detail">
                                    {checkErrors.map(e => e.filter ? `${e.filter}: ${e.error}` : e.error).join('\n')}
                                </Content>
                                <Content component={ContentVariants.small}>
                                    {_("The file is on disk but the configuration is not valid. Fix it here, or put back the previous version. minsec will refuse to start until this is resolved.")}
                                </Content>
                            </Alert>
                        </StackItem>}

                    <StackItem>
                        {loading
                            ? <Spinner size="lg" />
                            : <TextArea aria-label={_("File contents")} value={content} rows={22}
                                        onChange={(_e, v) => setContent(v)}
                                        resizeOrientation="vertical" className="ct-config-editor"
                                        spellCheck={false} />}
                    </StackItem>
                </Stack>
            </ModalBody>
            <ModalFooter>
                <Button variant="primary" onClick={save} isDisabled={!canSave} isLoading={busy}>
                    {_("Save")}
                </Button>
                <Button variant="link" onClick={onClose}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
}

export default function ConfigFiles({ doc, onChanged, ctx }) {
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState(null);

    const files = [
        { path: doc.paths.main_config, kind: _("Main configuration"), primary: true },
        ...(doc.files?.dropins || []).map(p => ({ path: p, kind: _("Drop-in") })),
        ...(doc.files?.custom_filters || []).map(p => ({ path: p, kind: _("Custom filter"), removable: true })),
    ];

    const remove = useCallback(async file => {
        setError(null);
        try {
            await minsec.writeFile(file.path, null);
            onChanged();
        } catch (err) {
            setError(err.message);
        }
    }, [onChanged]);

    return (
        <Card>
            <CardHeader actions={{
                actions: <Button variant="secondary" icon={<PlusCircleIcon />}
                                 isDisabled={ctx.admin === false}
                                 onClick={() => setEditing({ isNew: true })}>
                    {_("New custom filter")}
                </Button>
            }}>
                <CardTitle>{_("Configuration files")}</CardTitle>
            </CardHeader>
            <CardBody>
                <Content component={ContentVariants.small}>
                    {_("Files are read in this order; a later file overrides the same setting in an earlier one. Every change is checked before it is accepted.")}
                </Content>

                {error && <Alert variant="danger" isInline title={error} className="pf-v6-u-mt-md" />}

                <Table variant="compact" aria-label={_("Configuration files")} className="pf-v6-u-mt-md">
                    <Thead>
                        <Tr>
                            <Th width={60}>{_("File")}</Th>
                            <Th width={30}>{_("Purpose")}</Th>
                            <Th screenReaderText={_("Actions")} />
                        </Tr>
                    </Thead>
                    <Tbody>
                        {files.map(f => (
                            <Tr key={f.path}>
                                <Td dataLabel={_("File")}><code>{f.path}</code></Td>
                                <Td dataLabel={_("Purpose")}>
                                    <Label isCompact variant={f.primary ? 'filled' : 'outline'}>{f.kind}</Label>
                                </Td>
                                <Td isActionCell>
                                    <ActionsColumn items={[
                                        { title: _("Edit"), onClick: () => setEditing(f) },
                                        ...f.removable
                                            ? [{ title: _("Delete"), onClick: () => remove(f), isDanger: true }]
                                            : [],
                                    ]} isDisabled={ctx.admin === false} />
                                </Td>
                            </Tr>
                        ))}
                    </Tbody>
                </Table>
            </CardBody>

            <EditorDialog file={editing} isOpen={editing !== null}
                          onClose={() => setEditing(null)}
                          onSaved={() => { onChanged(); ctx.needsRestart() }} />
        </Card>
    );
}
