import { Injectable } from "@nestjs/common";

export interface QuestionCatalog {
  readonly version: number;
  readonly retired: boolean;
  readonly questions: readonly { readonly key: string; readonly prompt: string }[];
}

/** Server-owned immutable meanings. Register future approved versions; never reinterpret IDs. */
@Injectable()
export class QuestionnaireCatalog {
  readonly currentVersion = 1;
  private readonly versions: readonly QuestionCatalog[] = [{
    version: 1,
    retired: false,
    questions: [
      { key: "relationship-intention", prompt: "What are you hoping to build in a relationship?" },
      { key: "everyday-life", prompt: "What does a good ordinary day look like for you?" },
      { key: "values-and-boundaries", prompt: "Which values and boundaries matter most to you in a relationship?" },
    ],
  }];
  find(version: number): QuestionCatalog | undefined {
    return this.versions.find(catalog => catalog.version === version);
  }
}
