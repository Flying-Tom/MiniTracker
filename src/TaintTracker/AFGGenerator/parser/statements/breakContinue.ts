import * as ESTree from "../../estree";
import {
  Completion,
  EdgeType,
  EnclosingStatement,
  EnclosingStatementType,
  EnclosingTryStatement,
  FlowNode,
  ParsingContext
} from "../../flow";

export { parseBreakStatement, parseContinueStatement };

function parseBreakStatement(
  breakStatement: ESTree.BreakStatement,
  currentNode: FlowNode,
  context: ParsingContext
): Completion {
  let enclosingStatement = findLabeledEnclosingStatementForBreak(
    context,
    breakStatement.label
  );
  let finalizerCompletion = runFinalizersBeforeBreakOrContinue(
    currentNode,
    context,
    enclosingStatement
  );

  if (!finalizerCompletion.normal) {
    return finalizerCompletion;
  }

  enclosingStatement.breakTarget.appendAbruptCompletionTo(
    finalizerCompletion.normal,
    "break",
    breakStatement
  );

  return { break: true };
}

function parseContinueStatement(
  continueStatement: ESTree.ContinueStatement,
  currentNode: FlowNode,
  context: ParsingContext
): Completion {
  let enclosingStatement = findLabeledEnclosingStatementForContinue(
    context,
    continueStatement.label
  );

  if (enclosingStatement.continueTarget === null) {
    throw new Error(
      `Illegal continue target detected: "${
        continueStatement.label
      }" does not label an enclosing iteration statement`
    );
  }

  let finalizerCompletion = runFinalizersBeforeBreakOrContinue(
    currentNode,
    context,
    enclosingStatement
  );

  if (!finalizerCompletion.normal) {
    return finalizerCompletion;
  }

  enclosingStatement.continueTarget.appendAbruptCompletionTo(
    finalizerCompletion.normal,
    "continue",
    continueStatement
  );

  return { continue: true };
}

function findLabeledEnclosingStatementForBreak(
  context: ParsingContext,
  label: ESTree.Identifier
): EnclosingStatement {
  return context.enclosingStatements.find(statement => {
    if (label) {
      // If we have a truthy label, we look for a matching enclosing statement
      return statement.label === label.name;
    }

    // If we don't have a label, we look for the topmost enclosing statement
    // that is not a try statement because that would be an invalid target
    // for `break` or `continue` statements
    return statement.type !== EnclosingStatementType.TryStatement;
  });
}

function findLabeledEnclosingStatementForContinue(
  context: ParsingContext,
  label: ESTree.Identifier
): EnclosingStatement {
  return context.enclosingStatements.find(statement => {
    if (label) {
      // If we have a truthy label, we look for a matching enclosing statement
      return statement.label === label.name;
    }

    // If we don't have a label, we look for the topmost enclosing statement
    // that is not a try statement because that would be an invalid target
    // for `break` or `continue` statements
    return (statement.type !== EnclosingStatementType.TryStatement && statement.type !== EnclosingStatementType.SwitchStatement);
  });
}

function runFinalizersBeforeBreakOrContinue(
  currentNode: FlowNode,
  context: ParsingContext,
  target: EnclosingStatement
): Completion {
  let enclosingStatements = context.enclosingStatements.enumerateElements();

  for (let statement of enclosingStatements) {
    if (statement.type === EnclosingStatementType.TryStatement) {
      let tryStatement = <EnclosingTryStatement>statement;

      if (tryStatement.parseFinalizer && !tryStatement.isCurrentlyInFinalizer) {
        tryStatement.isCurrentlyInFinalizer = true;
        let finalizer = tryStatement.parseFinalizer();
        tryStatement.isCurrentlyInFinalizer = false;

        finalizer.bodyEntry.appendEpsilonEdgeTo(currentNode);

        if (finalizer.bodyCompletion.normal) {
          currentNode = finalizer.bodyCompletion.normal;
        } else {
          return finalizer.bodyCompletion;
        }
      }
    }

    if (statement === target) {
      // We only run finalizers of `try` statements that are nested
      // within the target enclosing statement. Therefore, stop here.
      break;
    }
  }

  return { normal: currentNode };
}
