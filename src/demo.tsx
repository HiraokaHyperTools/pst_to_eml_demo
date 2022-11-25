import React, { useCallback, useEffect, useState, } from 'react';
import ReactDOM from 'react-dom';
import { BehaviorSubject, throttleTime } from 'rxjs';
import Container from 'react-bootstrap/Container';
import Button from 'react-bootstrap/Button';
import Alert from 'react-bootstrap/Alert';
import Form from 'react-bootstrap/Form';
import ListGroup from 'react-bootstrap/ListGroup';
import Modal from 'react-bootstrap/Modal';
import Nav from 'react-bootstrap/Nav';
import { wrapPstFile, IPFolder, IPItem } from '@hiraokahypertools/pst_to_eml'
import { openPst, PSTFile } from '@hiraokahypertools/pst-extractor'

import 'bootstrap/dist/css/bootstrap.min.css';

let nextNumber = 1;
function nextUniqueKey(): string {
  return `${nextNumber++}`;
}

interface EntryItemStore {
  entryItemIsNull?: boolean;
  entryItemIsEmpty?: boolean;
  entryItemIsLoading?: boolean;
  entryItemIsError?: boolean;
  errorMessage?: string;
  items: EntryItem[];
}

interface EntryItem {
  key: string;
  display: string;
  messageClass: string;
  entry: IPItem | null;
}

function toItemIsConvertable(source: EntryItem): ItemIsConvertible {
  if (source.messageClass === "IPM.Contact") {
    return {
      canonicalFileName: `${source.display}.vcf`,
      async provider() {
        return source && source.entry && await source.entry.toVCardStr({}) || "";
      },
    };
  }
  else {
    return {
      canonicalFileName: `${source.display}.eml`,
      async provider() {
        return source && source.entry && await source.entry.toEmlStr({}) || "";
      },
    };
  }
}

interface FolderItem {
  key: string;
  display: string;
  entryItemsProvider: (progress?: ItemsProgress) => Promise<EntryItem[]>;
}

interface ItemIsConvertible {
  canonicalFileName: string;
  provider: () => Promise<string>;
}

type ItemsProgress = (current: number, count: number) => void;

const folderItemIsNull: FolderItem[] = [{
  key: "null",
  display: "(PST is not loaded yet)",
  async entryItemsProvider() {
    return [];
  },
}];

const folderItemIsEmpty: FolderItem[] = [{
  key: "noOne",
  display: "(Currently no item is available to display)",
  async entryItemsProvider() {
    return [];
  },
}];

const folderItemIsLoading: FolderItem[] = [{
  key: "loading",
  display: "(Loading)",
  async entryItemsProvider() {
    return [];
  },
}];

const entryItemIsNull: EntryItemStore = {
  entryItemIsNull: true,
  items: []
};

const entryItemIsEmpty: EntryItemStore = {
  entryItemIsEmpty: true,
  items: []
};

const entryItemIsLoading: EntryItemStore = {
  entryItemIsLoading: true,
  items: []
};

const ansiEncodingList = ["utf8", "ascii", "latin1", "armscii8", "big5hkscs", "cp437", "cp737", "cp775", "cp850",
  "cp852", "cp855", "cp856", "cp858", "cp860", "cp861", "cp862", "cp863", "cp864", "cp865", "cp866", "cp869",
  "cp922", "cp932", "cp936", "cp949", "cp950", "cp1046", "cp1124", "cp1125", "cp1129", "cp1133", "cp1161",
  "cp1162", "cp1163", "eucjp", "gb18030", "gbk", "georgianacademy", "georgianps", "hproman8", "iso646cn",
  "iso646jp", "iso88591", "iso88592", "iso88593", "iso88594", "iso88595", "iso88596", "iso88597", "iso88598",
  "iso88599", "iso885910", "iso885911", "iso885913", "iso885914", "iso885915", "iso885916", "koi8r", "koi8ru",
  "koi8t", "koi8u", "maccroatian", "maccyrillic", "macgreek", "maciceland", "macintosh", "macroman",
  "macromania", "macthai", "macturkish", "macukraine", "pt154", "rk1048", "shiftjis", "tcvn", "tis620", "viscii",
  "windows874", "windows1250", "windows1251", "windows1252", "windows1253", "windows1254", "windows1255",
  "windows1256", "windows1257", "windows1258"];

function PSTApp() {
  const fileSubject = new BehaviorSubject<File | null>(null);
  const foldersSubject = new BehaviorSubject<FolderItem[]>(folderItemIsNull);
  const entriesSubject = new BehaviorSubject<EntryItemStore>(entryItemIsNull);
  const previewTextSubject = new BehaviorSubject("");
  const ansiEncodingSubject = new BehaviorSubject("");
  const diskAccessSubject = new BehaviorSubject("not yet");
  const itemsProgressSubject = new BehaviorSubject("");

  const bytePositionFormatter = new Intl.NumberFormat('en-US');

  function onChange(input: HTMLInputElement) {
    (input.files?.length === 1) ? fileSubject.next(input.files[0]) : fileSubject.next(null);
  }

  async function openUserPst() {
    entriesSubject.next(entryItemIsEmpty);
    const file = fileSubject.value;
    if (file === null) {
      foldersSubject.next(folderItemIsNull);
      return;
    }
    foldersSubject.next(folderItemIsLoading);
    try {
      const diskCache = new Map<number, ArrayBuffer>();
      const cacheUnit = 1024 * 1024;
      const pst = await openPst({
        readFile: async (buffer: ArrayBuffer, offset: number, length: number, position: number) => {
          diskAccessSubject.next(`reading block at ${bytePositionFormatter.format(position)}`);
          const totalLen = length;
          const dest = new Uint8Array(buffer);

          while (1 <= length) {
            const cacheIdx = Math.floor(position / cacheUnit);
            const basePosition = cacheUnit * (cacheIdx);
            const boundaryPosition = cacheUnit * (cacheIdx + 1);
            let cache = diskCache.get(cacheIdx);
            if (cache === undefined) {
              diskCache.set(
                cacheIdx,
                cache = (await file.slice(basePosition, boundaryPosition).arrayBuffer())
              );
              console.info(`cache ${cacheIdx}`);
            }
            const chunkSize = Math.min(length, boundaryPosition - position);

            const source = cache.slice(position % cacheUnit, (position % cacheUnit) + chunkSize);
            dest.set(new Uint8Array(source), offset);

            offset += chunkSize;
            length -= chunkSize;
            position += chunkSize;
          }

          return totalLen;
        },
        close: async () => {
          fileSubject.next(null);
        },
      }, {
        ansiEncoding: (ansiEncodingSubject.value === "") ? undefined : ansiEncodingSubject.value
      });

      const pstRoot = await wrapPstFile(pst);

      const folderItems: FolderItem[] = [];
      async function walkFolder(folder: IPFolder, prefix: string) {
        folderItems.push({
          key: nextUniqueKey(),
          display: `${prefix} ${await folder.displayName()}`,
          entryItemsProvider: async (progress?: ItemsProgress) => {
            const items: EntryItem[] = [];
            for (let item of await folder.items({ progress })) {
              items.push({
                key: nextUniqueKey(),
                display: await item.displayName(),
                messageClass: item.messageClass,
                entry: item,
              });
            }

            return items;
          }
        })
        for (let subFolder of await folder.subFolders()) {
          await walkFolder(subFolder, `${prefix}*`);
        }
      }
      await walkFolder(pstRoot, "");
      foldersSubject.next((folderItems.length !== 0) ? folderItems : folderItemIsEmpty);
    }
    catch (ex) {
      previewTextSubject.next(`${ex}`);
    }
  }

  async function entryOnClick(convertible: ItemIsConvertible) {
    previewTextSubject.next("Loading...");

    try {
      previewTextSubject.next(await convertible.provider());
    } catch (ex) {
      previewTextSubject.next(`${ex}`);
    }
  }

  function FolderSelector() {
    const [folders, setFolders] = useState<FolderItem[]>([]);
    let currentAge = 0;
    const cancelEx = new Error("Cancel!");

    useEffect(
      () => {
        const subscription = foldersSubject.subscribe(
          value => setFolders(value)
        );
        return () => subscription.unsubscribe();
      },
      [foldersSubject]
    );

    async function folderOnChange(index: number) {
      ++currentAge;
      if (index < 0) {
        entriesSubject.next(entryItemIsNull);
        return;
      }
      entriesSubject.next(entryItemIsLoading);
      itemsProgressSubject.next("");
      try {
        let capturedAge = currentAge;
        const hits = await folders[index].entryItemsProvider(
          (x, cx) => {
            if (capturedAge !== currentAge) {
              throw cancelEx;
            }
            itemsProgressSubject.next(`${x} / ${cx}`);
          }
        );
        entriesSubject.next((hits.length !== 0) ? { items: hits } : entryItemIsEmpty);
      }
      catch (ex) {
        if (ex !== cancelEx) {
          entriesSubject.next({
            entryItemIsError: true,
            errorMessage: `${ex}`,
            items: [],
          });
          previewTextSubject.next(`${ex}`);
        }
      }
    }

    return (
      <Form.Select onChange={e => folderOnChange(e.target.selectedIndex)}>
        {folders.map(folder => <option key={folder.key}>{folder.display}</option>)}
      </Form.Select>
    );
  }

  function ReflectItemsProgress() {
    const [progress, setProgress] = useState("");

    useEffect(
      () => {
        const it = itemsProgressSubject
          .pipe(throttleTime(333))
          .subscribe(setProgress);
        return () => it.unsubscribe();
      },
      [itemsProgressSubject]
    );

    return <>{progress}</>;
  }

  function EntriesList() {
    const [store, setStore] = useState<EntryItemStore>(entryItemIsNull);

    useEffect(
      () => {
        const subscription = entriesSubject.subscribe(
          value => setStore(value)
        );
        return () => subscription.unsubscribe();
      },
      [entriesSubject]
    );

    return (
      <>
        {store.entryItemIsNull && <Alert key="null" variant="info">The folder is not selected yet</Alert>}
        {store.entryItemIsEmpty && <Alert key="empty" variant="info">The selected folder seems not to have good item to show</Alert>}
        {store.entryItemIsLoading && <Alert key="empty" variant="info">⏳ Listing items in this folder <ReflectItemsProgress /></Alert>}
        {store.entryItemIsError && <Alert key="empty" variant="warning">There is an error encountered while listing items in this folder<br /><br /><pre>{store.errorMessage}</pre></Alert>}
        <ListGroup>
          {store.items.map(entry =>
            <ListGroup.Item action={entry.entry !== null} key={entry.key} onClick={() => entry.entry && entryOnClick(toItemIsConvertable(entry))}>
              {entry.display}
            </ListGroup.Item>
          )}
        </ListGroup>
      </>
    );
  }

  function PreviewModal() {
    const [previewText, setPreviewText] = useState("");

    useEffect(
      () => {
        const subscription = previewTextSubject.subscribe(
          value => setPreviewText(value)
        );
        return () => subscription.unsubscribe();
      }
    );

    return (
      <Modal show={previewText.length !== 0} onHide={() => previewTextSubject.next("")} size='lg'>
        <Modal.Header closeButton>
          <Modal.Title>Preview</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Control as="textarea" cols={80} rows={10} value={previewText} readOnly={true} />
        </Modal.Body>
      </Modal>
    );
  }

  function ItemsCount() {
    const [count, setCount] = useState(0);

    useEffect(
      () => {
        const subscription = entriesSubject.subscribe(
          value => {
            setCount(value.items.length);
          }
        );
        return () => subscription.unsubscribe();
      }
    );

    if (count === 0) {
      return <>Items:</>;
    }
    else if (count === 1) {
      return <>1 item:</>;
    }
    else {
      return <>{count} items:</>;
    }
  }

  function Downloader() {
    const [list, setList] = useState<ItemIsConvertible[]>([]);
    const [wip, setWip] = useState(false);

    useEffect(
      () => {
        const subscription = entriesSubject.subscribe(
          value => {
            setList(value.items.map(toItemIsConvertable));
          }
        );
        return () => subscription.unsubscribe();
      },
      [entriesSubject]
    );

    function downloadAsFile(fileName: string, text: string) {
      const blob = new Blob([text], { type: "text/plain" });

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.click();
    }

    async function downloadAll() {
      setWip(true);
      try {
        try {
          for (let item of list) {
            downloadAsFile(
              item.canonicalFileName,
              await item.provider()
            );
          }
        }
        catch (ex) {
          previewTextSubject.next(`${ex}`);
        }
      }
      finally {
        setWip(false);
      }
    }

    const count = list.length;

    if (count === 0) {
      return <></>;
    }
    else {
      return (
        <>
          {wip
            ? <Button variant="outline-primary" disabled>In progress...</Button>
            : <Button variant="outline-primary" onClick={() => downloadAll()}>Download {count} items</Button>
          }
        </>
      );
    }
  }

  function DiskAccess() {
    const [status, setStatus] = useState("");

    useEffect(
      () => {
        const subscription = diskAccessSubject
          .pipe(throttleTime(333))
          .subscribe(setStatus);
        return () => subscription.unsubscribe();
      },
      [diskAccessSubject]
    );

    return <>{status}</>;
  }

  return <>
    <h1>pst_to_eml demo</h1>
    <Form.Group className="mb-3" controlId='selectPstFile'>
      <Form.Label>Select PST file</Form.Label>
      <Form.Control type="file"
        onChange={e => onChange(e.target as HTMLInputElement)} />
    </Form.Group>
    <Form.Group className="mb-3" controlId='selectAnsiEncoding'>
      <Form.Label>Select ansi encoding</Form.Label>
      <Form.Control placeholder="e.g. windows1251" onChange={e => ansiEncodingSubject.next(e.target.value)} list='ansiEncodingList' />
      <datalist id="ansiEncodingList">
        {ansiEncodingList.map(name => <option key={name} value={name}></option>)}
      </datalist>
    </Form.Group>
    <p><Button onClick={() => openUserPst()}>Open</Button>&nbsp;&nbsp;&nbsp;<i>Last disk access: <DiskAccess /></i></p>
    <p>Folder:<br /></p>
    <p>
      <FolderSelector />
    </p>
    <p>Folder actions:<br /><Downloader /></p>
    <p><ItemsCount /></p>
    <EntriesList />
    <PreviewModal />
  </>;
}

ReactDOM.render(
  <Container>
    <PSTApp />
  </Container>,
  document.getElementById('root')
);
