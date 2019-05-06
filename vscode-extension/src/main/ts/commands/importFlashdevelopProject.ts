/*
Copyright 2016-2019 Bowler Hat LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import parseXML = require("@rgrove/parse-xml");
import validateFrameworkSDK from "../utils/validateFrameworkSDK";

const FILE_ASCONFIG_JSON = "asconfig.json";
const FILE_ACTIONSCRIPT_PROPERTIES = ".as3proj";
const FILE_FLEX_PROPERTIES = ".flexProperties";
const FILE_FLEX_LIB_PROPERTIES = ".flexLibProperties";
const PATH_FLASH_BUILDER_WORKSPACE_SDK_PREFS = "../.metadata/.plugins/org.eclipse.core.runtime/.settings/com.adobe.flexbuilder.project.prefs";
const PATH_FLASH_BUILDER_WORKSPACE_RESOURCES_PREFS = "../.metadata/.plugins/org.eclipse.core.runtime/.settings/org.eclipse.core.resources.prefs";
const FILE_EXTENSION_SWF = ".swf";
const FILE_EXTENSION_SWC = ".swc";

const TOKEN_SDKS_PREF = "com.adobe.flexbuilder.project.flex_sdks=";
const TOKEN_PATHVARIABLE_PREF = "pathvariable.";

const MESSAGE_IMPORT_START = "🚀 Importing Flashdevelop project...";
const MESSAGE_IMPORT_COMPLETE = "✅ Import complete.";
const MESSAGE_IMPORT_FAILED = "❌ Import failed."
const ERROR_NO_FOLDER = "Workspace folder parameter is missing.";
const ERROR_NO_PROJECTS = "No Flashdevelop projects found in workspace.";
const ERROR_PROJECT_HAS_ASCONFIG = "No new Flashdevelop projects found in workspace. If a project already contains asconfig.json, it cannot be imported.";
const ERROR_FILE_READ = "Failed to read file: ";
const ERROR_XML_PARSE = "Failed to parse Flashdevelop project. Invalid XML.";
const ERROR_PROJECT_PARSE = "Failed to parse Flashdevelop project.";
const ERROR_CANNOT_FIND_SDKS = "Failed to parse SDKs in Flashdevelop workspace.";
const ERROR_ASCONFIG_JSON_EXISTS = "Cannot migrate Flashdevelop project because configuration file already exists... ";
const WARNING_CANNOT_FIND_LINKED_RESOURCES = "Failed to parse linked resources in Flashdevelop workspace. Result may contain path tokens that must be replaced.";
const WARNING_MODULE = "Flex modules are not supported. Skipping... ";
const WARNING_WORKER = "ActionScript workers are not supported. Skipping... ";
const WARNING_EXTERNAL_THEME = "Themes from outside SDK are not supported. Skipping...";
const CHANNEL_NAME_IMPORTER = "Flash Builder Importer";
const PROMPT_CHOOSE_PROJECT = "Choose a project to import";
const MESSAGE_DETECT_PROJECT = "Import existing Flashdevelop projects?";
const MESSAGE_DETECT_PROJECT2 = "Import more Flashdevelop projects?";
const BUTTON_LABEL_IMPORT = "Import";
const BUTTON_LABEL_NO_IMPORT = "Don't Import";

interface FlashdevelopSDK
{
    name: string;
    location: string;
    flashSDK: boolean;
    defaultSDK: boolean;
}

interface EclipseLinkedResource
{
    name: string;
    path: string;
}

export async function checkForFlashdevelopProjectsToImport()
{
    if(!shouldPromptToImport())
    {
        return;
    }

    let workspaceFolders = vscode.workspace.workspaceFolders.filter((folder) =>
    {
        return isFlashdevelopProject(folder) && !isVSCodeProject(folder);
    });
    if(workspaceFolders.length === 0)
    {
        return;
    }
    promptToImportWorkspaceFolders(workspaceFolders);
}

function onDidChangeWorkspaceFolders(event: vscode.WorkspaceFoldersChangeEvent)
{
    let added = event.added.filter((folder) =>
    {
        return isFlashdevelopProject(folder) && !isVSCodeProject(folder);
    });
    if(added.length === 0)
    {
        return;
    }
    checkForFlashdevelopProjectsToImport();
}
vscode.workspace.onDidChangeWorkspaceFolders(onDidChangeWorkspaceFolders);

export function pickFlashdevelopProjectInWorkspace()
{
    let workspaceFolders = vscode.workspace.workspaceFolders
    if(!workspaceFolders)
    {
        vscode.window.showErrorMessage(ERROR_NO_PROJECTS);
        return;
    }

    workspaceFolders = workspaceFolders.filter((folder) =>
    {
        return isFlashdevelopProject(folder);
    });
    if(workspaceFolders.length === 0)
    {
        vscode.window.showErrorMessage(ERROR_NO_PROJECTS);
        return;
    }

    workspaceFolders = workspaceFolders.filter((folder) =>
    {
        return !isVSCodeProject(folder);
    });
    if(workspaceFolders.length === 0)
    {
        vscode.window.showErrorMessage(ERROR_PROJECT_HAS_ASCONFIG);
        return;
    }

    pickFlashdevelopProjectInWorkspaceFolders(workspaceFolders);
}

function shouldPromptToImport()
{
    let as3mxmlConfig = vscode.workspace.getConfiguration("as3mxml");
    return as3mxmlConfig.get("projectImport.prompt");
}

function isFlashdevelopProject(folder: vscode.WorkspaceFolder)
{
    let asPropsPath = path.resolve(folder.uri.fsPath, FILE_ACTIONSCRIPT_PROPERTIES);
    return fs.existsSync(asPropsPath) && !fs.statSync(asPropsPath).isDirectory();
}

function isVSCodeProject(folder: vscode.WorkspaceFolder)
{
    let asconfigPath = path.resolve(folder.uri.fsPath, FILE_ASCONFIG_JSON);
    return fs.existsSync(asconfigPath) && !fs.statSync(asconfigPath).isDirectory();
}

async function promptToImportWorkspaceFolders(workspaceFolders: vscode.WorkspaceFolder[])
{
    let importedOne = false;
    while(workspaceFolders.length > 0)
    {
        let message = importedOne ? MESSAGE_DETECT_PROJECT2 : MESSAGE_DETECT_PROJECT;
        let value = await vscode.window.showInformationMessage(
            message,
            BUTTON_LABEL_IMPORT, BUTTON_LABEL_NO_IMPORT);
        if(value == BUTTON_LABEL_NO_IMPORT)
        {
            break;
        }
        let importedFolder = await pickFlashdevelopProjectInWorkspaceFolders(workspaceFolders);
        if(!importedFolder)
        {
            break;
        }
        workspaceFolders = workspaceFolders.filter((folder) =>
        {
            return folder !== importedFolder;
        });
        importedOne = true;
    }
}

async function pickFlashdevelopProjectInWorkspaceFolders(workspaceFolders: vscode.WorkspaceFolder[])
{
    if(workspaceFolders.length === 1)
    {
        let workspaceFolder = workspaceFolders[0];
        importFlashdevelopProject(workspaceFolder);
        return workspaceFolder;
    }
    else
    {
        let items = workspaceFolders.map((folder) =>
        {
            return { label: folder.name, description: folder.uri.fsPath, folder};
        })
        let result = await vscode.window.showQuickPick(items, { placeHolder: PROMPT_CHOOSE_PROJECT });
        if(!result)
        {
            //it's possible for no folder to be chosen when using
            //showWorkspaceFolderPick()
            return null;
        }
        let workspaceFolder = result.folder;
        importFlashdevelopProject(workspaceFolder);
        return workspaceFolder;
    }
}

function findLinkedResources(workspaceFolder: vscode.WorkspaceFolder): EclipseLinkedResource[]
{
    let result: EclipseLinkedResource[] = [];
    let resourcePrefsPath = path.resolve(workspaceFolder.uri.fsPath, PATH_FLASH_BUILDER_WORKSPACE_RESOURCES_PREFS);
    if(!fs.existsSync(resourcePrefsPath))
    {
        return result;
    }
    try
    {
        let resourcesPrefsText = null;
        try
        {
            resourcesPrefsText = fs.readFileSync(resourcePrefsPath, "utf8");
        }
        catch(error)
        {
            addWarning(ERROR_FILE_READ + resourcePrefsPath);
            return result;
        }
        let startIndex = resourcesPrefsText.indexOf(TOKEN_PATHVARIABLE_PREF);
        if(startIndex === -1)
        {
            return result;
        }
        do
        {
            startIndex += TOKEN_PATHVARIABLE_PREF.length;
            let endIndex = resourcesPrefsText.indexOf("\n", startIndex);
            if(endIndex === -1)
            {
                break;
            }
            let pathVar = resourcesPrefsText.substr(startIndex, endIndex - startIndex);
            let pathVarParts = pathVar.split("=")
            if(pathVarParts.length != 2)
            {
                //we couldn't parse this one for some reason
                continue;
            }
            let pathVarName = pathVarParts[0];
            let pathVarPath = pathVarParts[1];
            pathVarPath = pathVarPath.replace(/\\:/g, ":");
            pathVarPath = pathVarPath.replace(/\r/g, "");
            if(pathVarName === "DOCUMENTS" && path.isAbsolute(pathVarPath))
            {
                //special case: it's better to make this one a relative path
                //instead of leaving it as absolute
                pathVarPath = path.relative(workspaceFolder.uri.fsPath, pathVarPath);
            }
            result.push({ name: pathVarName, path: pathVarPath });
            startIndex = endIndex;
            startIndex = resourcesPrefsText.indexOf(TOKEN_PATHVARIABLE_PREF, startIndex);
        }
        while(startIndex !== -1);
    }
    catch(error)
    {
        return [];
    }
    return result;
}

function findSDKs(workspaceFolder: vscode.WorkspaceFolder): FlashdevelopSDK[]
{
    let sdkPrefsPath = path.resolve(workspaceFolder.uri.fsPath, PATH_FLASH_BUILDER_WORKSPACE_SDK_PREFS);
    if(!fs.existsSync(sdkPrefsPath))
    {
        return [];
    }

    let sdksElement = null;
    try
    {
        let sdkPrefsText = null;
        try
        {
            sdkPrefsText = fs.readFileSync(sdkPrefsPath, "utf8");
        }
        catch(error)
        {
            addWarning(ERROR_FILE_READ + sdkPrefsPath);
            return [];
        }
        let startIndex = sdkPrefsText.indexOf(TOKEN_SDKS_PREF);
        if(startIndex === -1)
        {
            return [];
        }
        startIndex += TOKEN_SDKS_PREF.length;
        let endIndex = sdkPrefsText.indexOf("\n", startIndex);
        if(endIndex === -1)
        {
            return [];
        }
        sdkPrefsText = sdkPrefsText.substr(startIndex, endIndex - startIndex);
        sdkPrefsText = sdkPrefsText.replace(/\\r/g, "\r");
        sdkPrefsText = sdkPrefsText.replace(/\\n/g, "\n");
        sdkPrefsText = sdkPrefsText.replace(/\\(.)/g, (match, p1) =>
        {
            return p1;
        });
        sdksElement = parseXML(sdkPrefsText)
    }
    catch(error)
    {
        return [];
    }
    let rootElement = sdksElement.children[0];
    let rootChildren = rootElement.children;
    return rootChildren
        .filter((child) =>
        {
            if(child.type !== "element" || child.name !== "sdk")
            {
                return false;
            }
            let attributes = child.attributes;
            return "name" in attributes && "location" in attributes && "flashSDK" in attributes;
        })
        .map((child) =>
        {
            let sdkAttributes = child.attributes;
            
            return {
                name: sdkAttributes.name,
                location: sdkAttributes.location,
                flashSDK: sdkAttributes.flashSDK === "true",
                defaultSDK: sdkAttributes.defaultSDK === "true"
            };
        });
}

function importFlashdevelopProject(workspaceFolder: vscode.WorkspaceFolder)
{
    getOutputChannel().clear();
    getOutputChannel().appendLine(MESSAGE_IMPORT_START);
    getOutputChannel().show();
    let result = importFlashdevelopProjectInternal(workspaceFolder);
    if(result)
    {
        getOutputChannel().appendLine(MESSAGE_IMPORT_COMPLETE);
    }
    else
    {
        getOutputChannel().appendLine(MESSAGE_IMPORT_FAILED);
    }
}

function importFlashdevelopProjectInternal(workspaceFolder: vscode.WorkspaceFolder): boolean
{
    if(!workspaceFolder)
    {
        addError(ERROR_NO_FOLDER);
        return false;
    }
    let folderPath = workspaceFolder.uri.fsPath;
    let actionScriptPropertiesPath = path.resolve(folderPath, FILE_ACTIONSCRIPT_PROPERTIES);
    if(!fs.existsSync(actionScriptPropertiesPath))
    {
        addError(ERROR_NO_PROJECTS);
        return false;
    }
    let asconfigPath = path.resolve(folderPath, FILE_ASCONFIG_JSON);
    if(fs.existsSync(asconfigPath))
    {
        addError(ERROR_ASCONFIG_JSON_EXISTS + FILE_ASCONFIG_JSON);
        return false;
    }

    let flexPropertiesPath = path.resolve(folderPath, FILE_FLEX_PROPERTIES);
    let isFlexApp = fs.existsSync(flexPropertiesPath);
    let flexLibPropertiesPath = path.resolve(folderPath, FILE_FLEX_LIB_PROPERTIES);
    let isFlexLibrary = fs.existsSync(flexLibPropertiesPath);

    let actionScriptPropertiesText = null;
    try
    {
        actionScriptPropertiesText = fs.readFileSync(actionScriptPropertiesPath, "utf8");
    }
    catch(error)
    {
        addError(ERROR_FILE_READ + actionScriptPropertiesPath);
        return false;
    }
    let actionScriptProperties = null;
    try
    {
        let parsedXML = parseXML(actionScriptPropertiesText);
        actionScriptProperties = parsedXML.children[0];
    }
    catch(error)
    {
        addError(ERROR_XML_PARSE);
        return false;
    }

    let linkedResources = null;
    try
    {
        linkedResources = findLinkedResources(workspaceFolder);;
    }
    catch(error)
    {
        addWarning(WARNING_CANNOT_FIND_LINKED_RESOURCES);
        if(error instanceof Error)
        {
            getOutputChannel().appendLine(error.stack);
        }
        linkedResources = [];
    }
    //these are built-in linked resources that cannot be configured by the user
    linkedResources.push({ name: "PROJECT_FRAMEWORKS", path: "${flexlib}"});
    linkedResources.push({ name: "SDK_THEMES_DIR", path: "${flexlib}/.."});

    let sdks = null;
    try
    {
        sdks = findSDKs(workspaceFolder);
    }
    catch(error)
    {
        addError(ERROR_CANNOT_FIND_SDKS);
        if(error instanceof Error)
        {
            getOutputChannel().appendLine(error.stack);
        }
        return false;
    }

    try
    {
        let result = createProjectFiles(folderPath, actionScriptProperties, sdks, linkedResources, isFlexApp, isFlexLibrary);
        if(!result)
        {
            return false;
        }
    }
    catch(error)
    {
        addError(ERROR_PROJECT_PARSE);
        if(error instanceof Error)
        {
            getOutputChannel().appendLine(error.stack);
        }
        return false;
    }

    return true;
}

let outputChannel: vscode.OutputChannel;

function getOutputChannel()
{
    if(!outputChannel)
    {
        outputChannel = vscode.window.createOutputChannel(CHANNEL_NAME_IMPORTER);
    }
    return outputChannel;
}

function addWarning(message: string)
{
    getOutputChannel().appendLine("🚧 " + message);
}

function addError(message: string)
{
    getOutputChannel().appendLine("⛔ " + message);
}

function findApplications(actionScriptProperties: any)
{
    if(!actionScriptProperties)
    {
        return [];
    }
    let rootChildren = actionScriptProperties.children as any[];
    if(!rootChildren)
    {
        return [];
    }
    let applicationsElement = findChildElementByName(rootChildren, "applications");
    if(!applicationsElement)
    {
        return [];
    }
    let appChildren = applicationsElement.children as any[];
    if(!appChildren)
    {
        return [];
    }
    return appChildren.filter((child) =>
    {
        return child.type === "element" && child.name === "application";
    })
}

function findMainApplicationPath(actionScriptProperties: any)
{
    let attributes = actionScriptProperties.attributes;
    if(!attributes)
    {
        return null;
    }
    return attributes.mainApplicationPath;
}

function getApplicationNameFromPath(appPath: string)
{
    appPath = path.basename(appPath);
    return appPath.substr(0, appPath.length - path.extname(appPath).length);
}

function createProjectFiles(folderPath: string, actionScriptProperties: any, sdks: FlashdevelopSDK[], linkedResources: EclipseLinkedResource[], isFlexApp: boolean, isFlexLibrary: boolean)
{
    let mainAppPath = findMainApplicationPath(actionScriptProperties);

    let applications = findApplications(actionScriptProperties);
    return applications.every((application) =>
    {
        let appPath = application.attributes.path;
        let appName = getApplicationNameFromPath(appPath);
        let fileName = FILE_ASCONFIG_JSON;
        if(appPath !== mainAppPath && applications.length > 1)
        {
            fileName = "asconfig." + appName + ".json";
        }
        let asconfigPath = path.resolve(folderPath, fileName);
        if(fs.existsSync(asconfigPath))
        {
            addError(ERROR_ASCONFIG_JSON_EXISTS + fileName);
            return false;
        }

        let result: any =
        {
            compilerOptions: {},
        };
        if(isFlexLibrary)
        {
            result.type = "lib";
        }
        else
        {
            result.files = [];
        }
        migrateActionScriptProperties(application, actionScriptProperties, isFlexApp, isFlexLibrary, sdks, linkedResources, result);
        if(isFlexLibrary)
        {
            let flexLibPropertiesPath = path.resolve(folderPath, FILE_FLEX_LIB_PROPERTIES);
            let flexLibPropertiesText = null;
            try
            {
                flexLibPropertiesText = fs.readFileSync(flexLibPropertiesPath, "utf8");
            }
            catch(error)
            {
                addError(ERROR_FILE_READ + flexLibPropertiesPath);
                return false;
            }
            let flexLibProperties = null;
            try
            {
                let parsedXML = parseXML(flexLibPropertiesText);
                flexLibProperties = parsedXML.children[0];
            }
            catch(error)
            {
                addError(ERROR_PROJECT_PARSE);
                if(error instanceof Error)
                {
                    getOutputChannel().appendLine(error.stack);
                }
                return false;
            }
            migrateFlexLibProperties(flexLibProperties, folderPath, linkedResources, result);
        }
        
        let resultText = JSON.stringify(result, undefined, "\t");
        fs.writeFileSync(asconfigPath, resultText);

        vscode.workspace.openTextDocument(asconfigPath).then((document) =>
        {
            vscode.window.showTextDocument(document)
        });

        getOutputChannel().appendLine(appName + " ➡ " + fileName);
        return true;
    });
}

function migrateFlexLibProperties(flexLibProperties: any, folderPath: string, linkedResources: EclipseLinkedResource[], result: any)
{
    let rootChildren = flexLibProperties.children as any[];
    if(!rootChildren)
    {
        return null;
    }
    let rootAttributes = flexLibProperties.attributes;
    if(!rootAttributes)
    {
        return null;
    }

    let includeAllClasses = false;
    if("includeAllClasses" in rootAttributes && rootAttributes.includeAllClasses === "true")
    {
        includeAllClasses = true;
        let includeSources = result.compilerOptions["include-sources"] || [];
        let sourcePaths = result.compilerOptions["source-path"] || [];
        includeSources = includeSources.concat(sourcePaths);
        if(includeSources.length > 0)
        {
            result.compilerOptions["include-sources"] = includeSources;
        }
    }

    if(!includeAllClasses)
    {
        let includeClassesElement = findChildElementByName(rootChildren, "includeClasses");
        if(includeClassesElement)
        {
            migrateIncludeClassesElement(includeClassesElement, linkedResources, result);
        }
    }

    let includeResourcesElement = findChildElementByName(rootChildren, "includeResources");
    if(includeResourcesElement)
    {
        migrateIncludeResourcesElement(includeResourcesElement, folderPath, result);
    }

    let namespaceManifestsElement = findChildElementByName(rootChildren, "namespaceManifests");
    if(namespaceManifestsElement)
    {
        migrateNamespaceManifestsElement(namespaceManifestsElement, folderPath, result);
    }
}

function migrateActionScriptProperties(application: any, actionScriptProperties: any,
    isFlexApp: boolean, isFlexLibrary: boolean, sdks: FlashdevelopSDK[],
    linkedResources: EclipseLinkedResource[], result: any)
{
    let rootChildren = actionScriptProperties.children as any[];
    if(!rootChildren)
    {
        return null;
    }
    let rootAttributes = actionScriptProperties.attributes;
    if(!rootAttributes)
    {
        return null;
    }
    let appAttributes = application.attributes;
    if(!appAttributes)
    {
        return null;
    }

    let applicationPath = null;
    if("path" in appAttributes)
    {
        applicationPath = appAttributes.path;
    }
    if(!applicationPath)
    {
        applicationPath = isFlexApp ? "MyProject.mxml" : "MyProject.as";
    }

    let compilerElement = findChildElementByName(rootChildren, "compiler");
    if(compilerElement)
    {
        migrateCompilerElement(compilerElement, applicationPath, isFlexLibrary, sdks, linkedResources, result);
    }

    if(!isFlexLibrary)
    {
        let buildTargetsElement = findChildElementByName(rootChildren, "buildTargets");
        if(buildTargetsElement)
        {
            migrateBuildTargetsElement(buildTargetsElement, applicationPath, linkedResources, result);
        }
    }

    if(!isFlexLibrary)
    {
        let modulesElement = findChildElementByName(rootChildren, "modules");
        if(modulesElement)
        {
            let moduleAppPath = applicationPath;
            if(compilerElement)
            {
                moduleAppPath = path.posix.join(compilerElement.attributes.sourceFolderPath, moduleAppPath);
            }
            migrateModulesElement(modulesElement, moduleAppPath, result);
        }
    }

    if(!isFlexLibrary)
    {
        let workersElement = findChildElementByName(rootChildren, "workers");
        if(workersElement)
        {
            migrateWorkersElement(workersElement, result);
        }
    }

    if(!isFlexLibrary)
    {
        let themeElement = findChildElementByName(rootChildren, "theme");
        if(themeElement)
        {
            migrateThemeElement(themeElement, linkedResources, result);
        }
    }
}

function findChildElementByName(children: any[], name: string)
{
    return children.find((child) =>
    {
        return child.type === "element" && child.name === name;
    });
}

function migrateCompilerElement(compilerElement: any, appPath: string, isFlexLibrary: boolean, sdks: FlashdevelopSDK[], linkedResources: EclipseLinkedResource[], result: any)
{
    let attributes = compilerElement.attributes;
    let frameworkSDKConfig = vscode.workspace.getConfiguration("as3mxml");
    let frameworkSDK = frameworkSDKConfig.inspect("sdk.framework").workspaceValue;
    if(!frameworkSDK)
    {
        let sdk: FlashdevelopSDK;
        let useFlashSDK = false;
        if("useFlashSDK" in attributes)
        {
            useFlashSDK = attributes.useFlashSDK === "true";
        }
        if(useFlashSDK)
        {
            sdk = sdks.find((sdk) =>
            {
                return sdk.flashSDK;
            });
        }
        else if("flexSDK" in attributes)
        {
            let sdkName = attributes.flexSDK;
            sdk = sdks.find((sdk) =>
            {
                return sdk.name === sdkName;
            });
        }
        else
        {
            sdk = sdks.find((sdk) =>
            {
                return sdk.defaultSDK;
            });
        }
        if(sdk)
        {
            let validatedSDKPath = validateFrameworkSDK(sdk.location);
            if(validatedSDKPath !== null)
            {
                frameworkSDKConfig.update("sdk.framework", validatedSDKPath);
            }
        }
    }
    if(!isFlexLibrary && "useApolloConfig" in attributes && attributes.useApolloConfig === "true")
    {
        result.application = path.posix.join(attributes.sourceFolderPath, getApplicationNameFromPath(appPath) + "-app.xml");
    }
    if(!isFlexLibrary && "copyDependentFiles" in attributes && attributes.copyDependentFiles === "true")
    {
        result.copySourcePathAssets = true;
    }
    if(!isFlexLibrary && "htmlGenerate" in attributes && attributes.htmlGenerate === "true")
    {
        result.htmlTemplate = "html-template";
    }
    if("outputFolderPath" in attributes)
    {
        let fileExtension = isFlexLibrary ? FILE_EXTENSION_SWC : FILE_EXTENSION_SWF;
        result.compilerOptions.output = path.posix.join(attributes.outputFolderPath, getApplicationNameFromPath(appPath) + fileExtension);
    }
    if("additionalCompilerArguments" in attributes)
    {
        result.additionalOptions = attributes.additionalCompilerArguments;
    }
    if("generateAccessible" in attributes && attributes.generateAccessible === "true")
    {
        result.compilerOptions.accessible = true;
    }
    if("strict" in attributes && attributes.strict !== "true")
    {
        result.compilerOptions.strict = false;
    }
    if("warn" in attributes && attributes.warn !== "true")
    {
        result.compilerOptions.warnings = false;
    }
    if("verifyDigests" in attributes && attributes.verifyDigests !== "true")
    {
        result.compilerOptions["verify-digests"] = false;
    }
    if("targetPlayerVersion" in attributes && attributes.targetPlayerVersion !== "0.0.0")
    {
        result.compilerOptions["target-player"] = attributes.targetPlayerVersion;
    }
    let sourceFolderPath: string = null;
    if("sourceFolderPath" in attributes)
    {
        sourceFolderPath = attributes.sourceFolderPath;
        if(!isFlexLibrary)
        {
            let mainFilePath = path.posix.join(attributes.sourceFolderPath, appPath);
            result.files.push(mainFilePath);
        }
    }
    let children = compilerElement.children as any[];
    let compilerSourcePathElement = findChildElementByName(children, "compilerSourcePath");
    if(compilerSourcePathElement)
    {
        migrateCompilerSourcePathElement(compilerSourcePathElement, sourceFolderPath, linkedResources, result);
    }
    let libraryPathElement = findChildElementByName(children, "libraryPath");
    if(libraryPathElement)
    {
        migrateCompilerLibraryPathElement(libraryPathElement, linkedResources, result);
    }
}

function migrateCompilerSourcePathElement(compilerSourcePathElement: any, sourceFolderPath: string, linkedResources: EclipseLinkedResource[], result: any)
{
    let sourcePaths = [];
    if(sourceFolderPath)
    {
        sourcePaths.push(sourceFolderPath);
    }
    let children = compilerSourcePathElement.children as any[];
    children.forEach((child) =>
    {
        if(child.type !== "element" || child.name !== "compilerSourcePathEntry")
        {
            return;
        }
        let attributes = child.attributes;
        if("path" in attributes && "kind" in attributes)
        {
            let sourcePath = resolvePathWithTokens(attributes.path as string, linkedResources);
            let kind = attributes.kind as string;
            if(kind !== "1")
            {
                console.warn("Skipping sources with unknown kind " + kind + " at path " + sourcePath);
                return;
            }
            sourcePaths.push(sourcePath);
        }
    });
    if(sourcePaths.length > 0)
    {
        result.compilerOptions["source-path"] = sourcePaths;
    }
}

function resolvePathWithTokens(pathWithTokens: string, linkedResources: EclipseLinkedResource[])
{
    linkedResources.forEach(linkedResource =>
    {
        let token = "${" + linkedResource.name + "}";
        pathWithTokens = pathWithTokens.replace(token, linkedResource.path);
    });
    return pathWithTokens;
}

function findOnSourcePath(thePath: string, folderPath: string, result: any)
{
    if(path.isAbsolute(thePath))
    {
        //only search for relative paths on the source path
        return thePath;
    }
    let sourcePath = result.compilerOptions["source-path"];
    if(sourcePath)
    {
        sourcePath.some((sourcePath) =>
        {
            let newPath = path.posix.join(sourcePath, thePath);
            let absolutePath = newPath;
            if(!path.isAbsolute(absolutePath))
            {
                absolutePath = path.resolve(folderPath, absolutePath);
            }
            if(fs.existsSync(absolutePath))
            {
                thePath = newPath;
                return true;
            }
            return false;
        });
    }
    return thePath;
}

function migrateCompilerLibraryPathElement(libraryPathElement: any, linkedResources: EclipseLinkedResource[], result: any)
{
    let libraryPaths = [];
    let externalLibraryPaths = [];

    let defaultLinkType = "0";
    let libraryPathAttributes = libraryPathElement.attributes;
    if("defaultLinkType" in libraryPathAttributes)
    {
        defaultLinkType = libraryPathAttributes.defaultLinkType;
    }

    let children = libraryPathElement.children as any[];
    children.forEach((child) =>
    {
        if(child.type !== "element" || child.name !== "libraryPathEntry")
        {
            return;
        }
        let libraryPathEntryAttributes = child.attributes;
        if("path" in libraryPathEntryAttributes &&
            "kind" in libraryPathEntryAttributes &&
            "linkType" in libraryPathEntryAttributes)
        {
            let libraryPath = resolvePathWithTokens(libraryPathEntryAttributes.path as string, linkedResources);
            //this path may not actually be absolute. in some cases, it should be
            //resolved relative to parent folder instead.
            if(libraryPath.startsWith("/"))
            {
                //if on windows or if the absolute path does not exist
                if(process.platform === "win32" || !fs.existsSync(libraryPath))
                {
                    libraryPath = ".." + libraryPath;
                }
            }
            
            let kind = libraryPathEntryAttributes.kind as string;
            if(kind !== "1" && //folder
                kind !== "3" && //swc
                kind !== "5") //ane
            {
                console.warn("Skipping library with unknown kind " + kind + " at path " + libraryPath);
                return;
            }
            let useDefaultLinkType = false;
            if("useDefaultLinkType" in libraryPathEntryAttributes)
            {
                useDefaultLinkType = libraryPathEntryAttributes.useDefaultLinkType === "true";
            }
            let linkType = libraryPathEntryAttributes.linkType;
            if (useDefaultLinkType && defaultLinkType !== "0")
            {
                linkType = defaultLinkType;
            }
            if(linkType === "1") //library-path
            {
                libraryPaths.push(libraryPath);
            }
            else if(linkType === "2") //external-ibrary-path
            {
                externalLibraryPaths.push(libraryPath);
            }
            else if(linkType === "3") //runtime shared library
            {
                console.warn("Skipping library with linkType 3 (runtime shared library) located at path: " + libraryPath);
            }
            else
            {
                console.warn("Skipping library with unknown linkType " + linkType + " located at path: " + libraryPath);
            }
        }
    });
    if(libraryPaths.length > 0)
    {
        result.compilerOptions["library-path"] = libraryPaths;
    }
    if(externalLibraryPaths.length > 0)
    {
        result.compilerOptions["external-library-path"] = externalLibraryPaths;
    }
}

function migrateBuildTargetsElement(buildTargetsElement: any, applicationFileName: string, linkedResources: EclipseLinkedResource[], result: any)
{
    let children = buildTargetsElement.children as any[];
    children.forEach((buildTarget) =>
    {
        if(buildTarget.type !== "element" || buildTarget.name !== "buildTarget")
        {
            return;
        }
        let buildTargetAttributes = buildTarget.attributes;
        if(!("platformId" in buildTargetAttributes))
        {
            return;
        }
        let platformId = buildTargetAttributes.platformId;
        let isIOS = platformId === "com.adobe.flexide.multiplatform.ios.platform";
        let isAndroid = platformId === "com.adobe.flexide.multiplatform.android.platform";
        let isDefault = platformId === "default";
        let buildTargetChildren = buildTarget.children;
        let multiPlatformSettings = findChildElementByName(children, "multiPlatformSettings");
        if(multiPlatformSettings)
        {
            let multiPlatformSettingsAttributes = multiPlatformSettings.attributes;
            if("enabled" in multiPlatformSettingsAttributes)
            {
                let enabled = multiPlatformSettingsAttributes.enabled === "true";
                if(!enabled)
                {
                    //we can skip this one because it's not enabled
                    return;
                }
            }
        }
        result.airOptions = result.airOptions || {};
        let platformOptions = null;
        if(isIOS)
        {
            platformOptions = result.airOptions.ios || {};
            platformOptions.output = path.posix.join(getApplicationNameFromPath(applicationFileName) + ".ipa");
            if("provisioningFile" in buildTargetAttributes)
            {
                let provisioningFile = buildTargetAttributes.provisioningFile;
                if(provisioningFile)
                {
                    provisioningFile = resolvePathWithTokens(provisioningFile, linkedResources);
                    platformOptions.signingOptions = platformOptions.signingOptions || {};
                    platformOptions.signingOptions["provisioning-profile"] = provisioningFile;
                }
            }
        }
        else if(isAndroid)
        {
            platformOptions = result.airOptions.android || {};
            platformOptions.output = path.posix.join(getApplicationNameFromPath(applicationFileName) + ".apk");
        }
        else if(isDefault)
        {
            result.config = "air";
            platformOptions = result.airOptions;
            platformOptions.output = path.posix.join(getApplicationNameFromPath(applicationFileName) + ".air");
        }
        else
        {
            vscode.window.showErrorMessage("Unknown Adobe AIR platform in Flashdevelop project: " + platformId);
            return;
        }
        if(isIOS || isAndroid)
        {
            result.config = "airmobile";
        }
        let airSettings = findChildElementByName(buildTargetChildren, "airSettings");
        if(airSettings)
        {
            let airSettingsAttributes = airSettings.attributes;
            if("airCertificatePath" in airSettingsAttributes)
            {
                let airCertificatePath = airSettingsAttributes.airCertificatePath;
                if(airCertificatePath)
                {
                    airCertificatePath = resolvePathWithTokens(airCertificatePath, linkedResources);
                    platformOptions.signingOptions = platformOptions.signingOptions || {};
                    platformOptions.signingOptions.keystore = airCertificatePath;
                    platformOptions.signingOptions.storetype = "pkcs12";
                }
            }
            let airSettingsChildren = airSettings.children;
            let anePaths = findChildElementByName(airSettingsChildren, "anePaths");
            if(anePaths)
            {
                let anePathsChildren = anePaths.children;
                let anePathEntries = anePathsChildren.filter((child) =>
                {
                    return child.type === "element" && child.name === "anePathEntry";
                });
                if(anePathEntries.length > 0)
                {
                    let extdir = [];
                    anePathEntries.forEach((anePathEntry) =>
                    {
                        let anePathEntryAttributes = anePathEntry.attributes;
                        if("path" in anePathEntryAttributes)
                        {
                            let extdirPath = anePathEntryAttributes.path;
                            extdirPath = resolvePathWithTokens(extdirPath, linkedResources);
                            extdir.push(extdirPath);
                        }
                    });
                    platformOptions.extdir = extdir;
                }
            }
        }
    });
}

function migrateModulesElement(modulesElement: any, appPath: string, result: any)
{
    let children = modulesElement.children as any[];
    let modules = children.filter((child) =>
    {
        return child.type === "element" && child.name === "module" && child.attributes.application === appPath;
    });
    modules.forEach((module) =>
    {
        let attributes = module.attributes;
        let moduleSourcePath = "sourcePath" in attributes ? attributes.sourcePath : "";
        addWarning(WARNING_MODULE + moduleSourcePath);
    });
}

function migrateWorkersElement(workersElement: any, result: any)
{
    let children = workersElement.children as any[];
    let workers = children.filter((child) =>
    {
        return child.type === "element" && child.name === "worker";
    });
    workers.forEach((worker) =>
    {
        let attributes = worker.attributes;
        let workerPath = "path" in attributes ? attributes.path : "";
        addWarning(WARNING_WORKER + workerPath);
    });
}

function migrateThemeElement(themeElement: any, linkedResources: EclipseLinkedResource[], result: any)
{
    let themeAttributes = themeElement.attributes;
    if("themeIsSDK" in themeAttributes && themeAttributes.themeIsSDK !== "true")
    {
        addWarning(WARNING_EXTERNAL_THEME);
        return;
    }
    if("themeLocation" in themeAttributes)
    {
        let themeLocation = themeAttributes.themeLocation;
        themeLocation = resolvePathWithTokens(themeLocation, linkedResources);
        result.compilerOptions.theme = themeLocation;
    }
}

function migrateIncludeClassesElement(includeClassesElement: any, linkedResources: EclipseLinkedResource[], result: any)
{
    let children = includeClassesElement.children as any[];
    if(!children)
    {
        return null;
    }
    let newClasses = children
        .filter((child) =>
        {
            return child.type === "element" && child.name === "classEntry";
        })
        .map((child) =>
        {
            let includeClassesPath = child.attributes.path;
            return resolvePathWithTokens(includeClassesPath, linkedResources);
        });
    if(newClasses.length > 0)
    {
        result.compilerOptions["include-classes"] = newClasses;
    }
}

function migrateIncludeResourcesElement(includeResourcesElement: any, folderPath: string, result: any)
{
    let children = includeResourcesElement.children as any[];
    if(!children)
    {
        return null;
    }
    let newFiles = children
        .filter((child) =>
        {
            return child.type === "element" && child.name === "resourceEntry";
        })
        .map((child) =>
        {
            let file = child.attributes.sourcePath;
            file = findOnSourcePath(file, folderPath, result);
            return { file, path: child.attributes.destPath };
        });
    if(newFiles.length > 0)
    {
        result.compilerOptions["include-file"] = newFiles;
    }
}

function migrateNamespaceManifestsElement(namespaceManifestsElement: any, folderPath: string, result: any)
{
    let children = namespaceManifestsElement.children as any[];
    if(!children)
    {
        return null;
    }
    let newManifests = children
        .filter((child) =>
        {
            return child.type === "element" && child.name === "namespaceManifestEntry";
        })
        .map((child) =>
        {
            let manifest = child.attributes.manifest;
            manifest = findOnSourcePath(manifest, folderPath, result);
            return { uri: child.attributes.namespace, manifest };
        });
    if(newManifests.length > 0)
    {
        result.compilerOptions["namespace"] = newManifests;
    }
    let uris = newManifests.map((child) =>
    {
        return child.uri;
    });
    if(uris.length > 0)
    {
        result.compilerOptions["include-namespaces"] = uris;
    }
}
